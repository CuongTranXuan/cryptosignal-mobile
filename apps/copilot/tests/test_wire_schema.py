"""Backend analyze shapes must satisfy the web PatternShape strict schema."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.chart_real_path import run_real_path, simulate_llm_top_intents
from cryptosignal_copilot.drawing_intent import resolve_drawing_intents, enrich_resolved_shapes
from cryptosignal_copilot.schema import Candle, filter_preview_details
from cryptosignal_copilot.drawing_gate import DrawingWindow
from cryptosignal_copilot.chart_response import enrich_shapes_with_guardrails
from cryptosignal_copilot.wire_marker import WIRE_MARKER_TOP_KEYS, markers_for_wire
from cryptosignal_copilot.wire_shape import WIRE_SHAPE_TOP_KEYS, shapes_for_wire

FIXTURE = (
    Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "ohlcv" / "btcusdt_1h_200.json"
)
WEB_ROOT = Path(__file__).resolve().parents[2] / "web"
ZOD_SHAPE_SCRIPT = """
import { readFileSync } from "node:fs";
import { PatternShapeSchema } from "./lib/pattern-shape.ts";

const shapes = JSON.parse(readFileSync(0, "utf8"));
for (const shape of shapes) {
  PatternShapeSchema.parse(shape);
}
console.log("ok", shapes.length);
"""

ZOD_MARKER_SCRIPT = """
import { readFileSync } from "node:fs";
import { z } from "zod";
import { AgentMarkerSchema } from "./lib/pattern-shape.ts";
import { DrawingGuardrailSchema } from "./lib/copilot-schema.ts";

const WireAgentMarkerSchema = AgentMarkerSchema.extend({
  drawing_id: z.string().min(1).optional(),
  guardrail: DrawingGuardrailSchema.optional(),
}).strict();

const markers = JSON.parse(readFileSync(0, "utf8"));
for (const marker of markers) {
  WireAgentMarkerSchema.parse(marker);
}
console.log("ok", markers.length);
"""


def _require_web_zod() -> None:
    """Run the Zod contract only where apps/web deps are installed.

    Skips when node or apps/web/node_modules/zod is missing (e.g. a Python-only job);
    `COPILOT_REQUIRE_WEB_ZOD=1` turns a missing dependency into a failure instead.
    """
    missing = None
    if shutil.which("node") is None or shutil.which("npx") is None:
        missing = "node/npx is not installed"
    elif not (WEB_ROOT / "node_modules" / "zod" / "package.json").is_file():
        missing = "apps/web deps not installed (node_modules/zod missing; run pnpm install)"
    if missing is None:
        return
    if os.environ.get("COPILOT_REQUIRE_WEB_ZOD", "").lower() in {"1", "true", "yes"}:
        raise AssertionError(missing)
    pytest.skip(missing)


def _load() -> tuple[str, str, list[Candle]]:
    payload = json.loads(FIXTURE.read_text())
    candles = [Candle.model_validate(row) for row in payload["candles"]]
    return str(payload["symbol"]), str(payload["interval"]), candles


def test_wire_shape_keys_match_web_contract():
    symbol, interval, candles = _load()
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    valid, _ = run_real_path(catalog, candles, symbol=symbol, interval=interval, style="classic")
    assert valid
    for shape in valid:
        assert not any(str(k).startswith("_") for k in shape)
        assert set(shape.keys()) <= WIRE_SHAPE_TOP_KEYS


def test_wire_shapes_pass_web_zod_when_node_available():
    _require_web_zod()
    symbol, interval, candles = _load()
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    valid, _ = run_real_path(catalog, candles, symbol=symbol, interval=interval, style="classic")
    proc = subprocess.run(
        ["npx", "tsx", "-e", ZOD_SHAPE_SCRIPT],
        input=json.dumps(shapes_for_wire(valid)).encode(),
        cwd=WEB_ROOT,
        capture_output=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr.decode()


def test_wire_marker_keys_match_contract():
    symbol, interval, candles = _load()
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    valid, _ = run_real_path(catalog, candles, symbol=symbol, interval=interval, style="classic")
    assert valid
    enriched, anchors = enrich_shapes_with_guardrails(
        valid, regime=str(catalog.regime), symbol=symbol, interval=interval
    )
    assert anchors
    wire = markers_for_wire(anchors)
    for marker in wire:
        assert set(marker.keys()) <= WIRE_MARKER_TOP_KEYS


def test_wire_markers_pass_web_zod_when_node_available():
    _require_web_zod()
    symbol, interval, candles = _load()
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    valid, _ = run_real_path(catalog, candles, symbol=symbol, interval=interval, style="classic")
    enriched, anchors = enrich_shapes_with_guardrails(
        valid, regime=str(catalog.regime), symbol=symbol, interval=interval
    )
    wire = markers_for_wire(anchors)
    proc = subprocess.run(
        ["npx", "tsx", "-e", ZOD_MARKER_SCRIPT],
        input=json.dumps(wire).encode(),
        cwd=WEB_ROOT,
        capture_output=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr.decode()


def test_internal_sidecar_still_has_candidate_id_before_wire_strip():
    symbol, interval, candles = _load()
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    intents = simulate_llm_top_intents(catalog, "classic")
    shapes, _ = resolve_drawing_intents(intents, catalog)
    shapes = enrich_resolved_shapes(shapes, catalog, last_close=float(candles[-1].close))
    assert any(s.get("_candidate_id") for s in shapes)
    window = DrawingWindow(
        candles=candles,
        interval=interval,  # type: ignore[arg-type]
        window_start=candles[0].time,
        allowed_times={c.time for c in candles},
    )
    gated, _ = filter_preview_details(
        shapes,
        {c.time for c in candles},
        symbol=symbol,
        interval=interval,  # type: ignore[arg-type]
        window=window,
    )
    assert any(s.get("_candidate_id") for s in gated)
    wire = shapes_for_wire(gated)
    assert all("_candidate_id" not in s for s in wire)
