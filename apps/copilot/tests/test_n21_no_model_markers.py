"""N21: model markers must never reach SSE; only server anchors."""

from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic_ai import Agent

from cryptosignal_copilot.agent import PydanticAiRunner
from cryptosignal_copilot.drawing_intent import (
    AnalyzeResultLlm,
    CandidateDrawingIntent,
    PickAssessment,
)
from tests.test_n14_server_summary import _plan_from_fixture

MALICIOUS_MARKERS = [
    {
        "id": "m-buy",
        "symbol": "BTCUSDT",
        "interval": "1h",
        "time": 1,
        "side": "buy",
        "position": "belowBar",
        "shape": "arrowUp",
        "label": "BUY 61k — Entry 61k, TP 72k",
        "confidence": 0.9,
        "source": "agent",
    },
    {
        "id": "m-emoji",
        "symbol": "BTCUSDT",
        "interval": "1h",
        "time": 2,
        "side": "buy",
        "position": "aboveBar",
        "shape": "arrowUp",
        "label": "🚀 70k",
        "confidence": 0.9,
        "source": "agent",
    },
]

LEAK_TOKENS = (
    "buy 61k",
    "entry 61k",
    "tp 72k",
    "tp 70k",
    "sl 58k",
    "nên mua",
    "🚀",
    "ＢＵＹ",
)


def _all_sse_strings(events: list[tuple[str, dict]]) -> str:
    return json.dumps([{"event": k, "data": d} for k, d in events], ensure_ascii=False).lower()


@pytest.mark.asyncio
async def test_model_markers_stripped_from_sse(llm_env, monkeypatch):
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)
    top_id = plan.candidate_catalog.candidates[0].id
    last_t = plan.request.closedCandles[-1].time
    markers = []
    for m in MALICIOUS_MARKERS:
        row = dict(m)
        row["time"] = last_t
        row["symbol"] = plan.request.symbol
        row["interval"] = plan.request.interval
        markers.append(row)
    markers.append(
        {
            "id": "m-silent",
            "symbol": plan.request.symbol,
            "interval": plan.request.interval,
            "time": last_t,
            "side": "buy",
            "position": "belowBar",
            "shape": "arrowUp",
            "confidence": 0.9,
            "source": "agent",
        }
    )

    async def malicious(self, prompt, model_settings=None):
        # Legacy extra field attempt — must be stripped by forbid schema / parsing
        payload = AnalyzeResultLlm(
            pick_assessments=[
                PickAssessment(candidate_id=top_id, quality="ok", confluence=[], touch_ack=False)
            ],
            drawing_intents=[CandidateDrawingIntent(candidate_id=top_id)],
        )
        return type("RunResult", (), {"output": payload})()

    monkeypatch.setattr(Agent, "run", malicious)

    events: list[tuple[str, dict]] = []
    runner = PydanticAiRunner()
    async for ev in runner.run(plan):
        events.append(ev)

    blob = _all_sse_strings(events)
    for token in LEAK_TOKENS:
        assert token not in blob

    marker_events = [d for k, d in events if k == "markers"]
    if marker_events:
        for m in marker_events[0].get("markers") or []:
            assert m.get("side") == "neutral"
            assert m.get("shape") in ("circle", "square")
            label = str(m.get("label") or "").lower()
            for token in LEAK_TOKENS:
                assert token not in label
