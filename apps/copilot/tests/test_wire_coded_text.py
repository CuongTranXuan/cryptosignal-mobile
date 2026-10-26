"""C.16 wire fixture: `analysis` + `shapes` + `markers` events with coded Vietnamese text.

Fixture: tests/fixtures/wire/analyze_coded_text.json (scripted model, BTCUSDT 4h, 200
closed bars). Regenerate with `python -m tests.test_wire_coded_text` from apps/copilot.
The additive fields (`evidence_*_items`, invalidation `code`/`params`/`text`,
guardrail `evidence_against_items`) must parse with the web Zod schemas.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from tests.test_vi_leftovers import _run
from tests.test_wire_schema import WEB_ROOT, _require_web_zod

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "analyze_coded_text.json"
CASE = ("btcusdt_4h_200.json", "classic")

ZOD_SCRIPT = """
import { readFileSync } from "node:fs";
import { z } from "zod";
import { AnalysisSseEventSchema, DrawingGuardrailSchema } from "./lib/copilot-schema.ts";
import { PatternShapeSchema, AgentMarkerSchema } from "./lib/pattern-shape.ts";

const events = JSON.parse(readFileSync(0, "utf8"));
AnalysisSseEventSchema.parse(events.analysis);
for (const shape of events.shapes.shapes) PatternShapeSchema.parse(shape);
const Marker = AgentMarkerSchema.extend({
  drawing_id: z.string().min(1).optional(),
  guardrail: DrawingGuardrailSchema.optional(),
}).strict();
for (const marker of events.markers.markers) Marker.parse(marker);
console.log("ok");
"""


async def _capture(monkeypatch) -> dict[str, Any]:
    events = await _run(*CASE, monkeypatch)
    out = {kind: data for kind, data in events if kind in ("analysis", "shapes", "markers")}
    assert set(out) == {"analysis", "shapes", "markers"}
    return out


def _codes(body: dict[str, Any]) -> dict[str, Any]:
    analysis = body["analysis"]
    return {
        "for": [i["code"] for i in analysis["evidence_for_items"]],
        "against": [i["code"] for i in analysis["evidence_against_items"]],
        "inv": (analysis["invalidation"] or {}).get("code"),
        "shapes": [
            (
                [i["code"] for i in s["guardrail"]["evidence_against_items"]],
                (s["guardrail"].get("invalidation") or {}).get("code"),
            )
            for s in body["shapes"]["shapes"]
        ],
    }


@pytest.mark.asyncio
async def test_coded_text_matches_fixture(llm_env, monkeypatch):
    live = await _capture(monkeypatch)
    fixture = json.loads(FIXTURE.read_text())
    assert _codes(live) == _codes(fixture)
    assert live["analysis"]["evidence_for"] == fixture["analysis"]["evidence_for"]
    assert live["analysis"]["evidence_against"] == fixture["analysis"]["evidence_against"]


def test_coded_text_fixture_passes_web_zod():
    _require_web_zod()
    proc = subprocess.run(
        ["npx", "tsx", "-e", ZOD_SCRIPT],
        input=FIXTURE.read_bytes(),
        cwd=WEB_ROOT,
        capture_output=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr.decode()


def _regenerate() -> None:  # pragma: no cover - dev helper
    import os

    mp = pytest.MonkeyPatch()
    for key, value in {
        "LLM_API_STYLE": "openai",
        "LLM_BASE_URL": "http://127.0.0.1:20128/v1",
        "LLM_API_KEY": "sk-test",
        "LLM_MODEL": "agentrouter/deepseek-v4-flash",
        "COPILOT_SKIP_HTF": "1",
    }.items():
        mp.setenv(key, value)
    os.environ.setdefault("COPILOT_TICK_FETCH", "0")
    try:
        body = asyncio.run(_capture(mp))
    finally:
        mp.undo()
    FIXTURE.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":  # pragma: no cover
    _regenerate()
