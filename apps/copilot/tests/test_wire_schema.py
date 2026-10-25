"""Backend analyze shapes must satisfy the web PatternShape strict schema."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.chart_real_path import run_real_path, simulate_llm_top_intents
from cryptosignal_copilot.drawing_intent import resolve_drawing_intents, enrich_resolved_shapes
from cryptosignal_copilot.schema import Candle, filter_preview_details
from cryptosignal_copilot.drawing_gate import DrawingWindow
from cryptosignal_copilot.wire_shape import WIRE_SHAPE_TOP_KEYS, shapes_for_wire

FIXTURE = (
    Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "ohlcv" / "btcusdt_1h_200.json"
)
WEB_ROOT = Path(__file__).resolve().parents[2] / "web"
ZOD_SCRIPT = """
import { readFileSync } from "node:fs";
import { PatternShapeSchema } from "./lib/pattern-shape.ts";

const shapes = JSON.parse(readFileSync(0, "utf8"));
for (const shape of shapes) {
  PatternShapeSchema.parse(shape);
}
console.log("ok", shapes.length);
"""


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
    symbol, interval, candles = _load()
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    valid, _ = run_real_path(catalog, candles, symbol=symbol, interval=interval, style="classic")
    if not (WEB_ROOT / "package.json").exists():
        return
    proc = subprocess.run(
        ["npx", "tsx", "-e", ZOD_SCRIPT],
        input=json.dumps(valid).encode(),
        cwd=WEB_ROOT,
        capture_output=True,
        timeout=120,
    )
    if proc.returncode != 0 and b"Cannot find" in proc.stderr:
        return
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
