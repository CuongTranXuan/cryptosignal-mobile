"""N18: injected leak phrases must never appear in any SSE payload string."""

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
from cryptosignal_copilot.text_leak import contains_leak_phrase, normalize_for_leak_scan
from tests.test_n14_server_summary import _plan_from_fixture

LEAK_INJECTIONS = [
    "nen mua o 60k",
    "N\u200bên mua ở 60k",
    "L0ng ở 60k",
    "Entry 60k",
    "Buy @ 65k",
    "Target $70,000",
    "Mục tiêu 70k",
    "Dừng lỗ 58k",
    "Stop dưới 58k",
    "Đà tăng sắp bắt đầu",
    "Giá có thể bứt phá lên 70k",
    "Bullish breakout imminent",
    "Phe short yếu; nên mua ở 60k. Đà tăng sắp bắt đầu…",
]


def _all_strings(obj: Any) -> list[str]:
    out: list[str] = []
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            out.extend(_all_strings(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_all_strings(v))
    return out


def _leaks_in_sse(events: list[tuple[str, dict]]) -> list[str]:
    found: list[str] = []
    blob = "\n".join(_all_strings([d for _, d in events]))
    norm_blob = normalize_for_leak_scan(blob)
    for phrase in LEAK_INJECTIONS:
        if normalize_for_leak_scan(phrase) in norm_blob:
            found.append(phrase)
    return found


@pytest.mark.asyncio
async def test_structured_output_never_streams_injected_free_text(llm_env, monkeypatch):
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)
    top_id = plan.candidate_catalog.candidates[0].id

    async def malicious_model(self, prompt, model_settings=None):
        return type(
            "RunResult",
            (),
            {
                "output": AnalyzeResultLlm(
                    pick_assessments=[
                        PickAssessment(
                            candidate_id=top_id,
                            quality="strong",
                            confluence=["fib"],
                            touch_ack=True,
                        )
                    ],
                    drawing_intents=[CandidateDrawingIntent(candidate_id=top_id)],
                    markers=[
                        {
                            "id": "m-leak",
                            "symbol": plan.request.symbol,
                            "interval": plan.request.interval,
                            "time": plan.request.closedCandles[-1].time,
                            "side": "neutral",
                            "position": "aboveBar",
                            "shape": "circle",
                            "label": LEAK_INJECTIONS[0],
                            "confidence": 0.6,
                            "source": "agent",
                        }
                    ],
                )
            },
        )()

    monkeypatch.setattr(Agent, "run", malicious_model)
    events: list[tuple[str, dict]] = []
    runner = PydanticAiRunner()
    async for ev in runner.run(plan):
        events.append(ev)

    leaks = _leaks_in_sse(events)
    assert leaks == [], f"leaks reached stream: {leaks}"


def test_leak_scan_catches_research_phrases():
    assert contains_leak_phrase("nen mua o 60k")
    assert contains_leak_phrase("L0ng ở 60k")
