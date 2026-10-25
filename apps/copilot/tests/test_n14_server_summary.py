"""N14: server-authored bias text; model cannot stream directional free text."""

from __future__ import annotations

import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import UnexpectedModelBehavior

from cryptosignal_copilot.agent import PydanticAiRunner
from cryptosignal_copilot.analyze_prep import AnalyzePlan
from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.drawing_intent import (
    AnalyzeResultLlm,
    CandidateDrawingIntent,
    PickAssessment,
)
from cryptosignal_copilot.intent_prep import build_intent_check, validate_analyze_intent
from cryptosignal_copilot.intent_step import rules_first_step
from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.schema import AnalyzeRequest
from tests.eval.test_chart_replay import _load_fixture


def _plan_from_fixture(fixture: str, *, candle_count: int) -> AnalyzePlan:
    symbol, interval, candles = _load_fixture(fixture)
    use = candles[-candle_count:]
    request = AnalyzeRequest.model_validate(
        {
            "symbol": symbol,
            "interval": interval,
            "from": use[0].time,
            "to": use[-1].time,
            "closedCandles": [c.model_dump() for c in use],
            "existingShapes": [],
            "prompt": "Phân tích chart",
            "candle_count": candle_count,
            "intent": {"style": "classic"},
        }
    )
    catalog = build_candidate_catalog(
        request.closedCandles, symbol=request.symbol, interval=request.interval
    )
    assert catalog.candidates
    intent = validate_analyze_intent(request.intent)
    step = rules_first_step(request, catalog, intent)
    model = normalize_model_row({"id": "agentrouter/deepseek-v4-flash", "owned_by": "agentrouter"})
    return AnalyzePlan(
        model_id=model.id,
        model=model,
        request=request,
        meta={
            "intent_check": build_intent_check(request, intent),
            "llm_provider": "generic",
        },
        model_settings={},
        reasoning_effort=None,
        candle_count_requested=candle_count,
        candle_count_used=candle_count,
        candidate_catalog=catalog,
        intent_step=step,
    )


@pytest.mark.asyncio
async def test_stream_uses_server_bias_not_model_story(llm_env, monkeypatch):
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)
    top_id = plan.candidate_catalog.candidates[0].id

    async def structured_model(self, prompt, model_settings=None):
        return type(
            "RunResult",
            (),
            {
                "output": AnalyzeResultLlm(
                    pick_assessments=[
                        PickAssessment(
                            candidate_id=top_id,
                            quality="ok",
                            confluence=["structure"],
                            touch_ack=True,
                        )
                    ],
                    drawing_intents=[CandidateDrawingIntent(candidate_id=top_id)],
                )
            },
        )()

    monkeypatch.setattr(Agent, "run", structured_model)
    events: list[tuple[str, dict]] = []
    runner = PydanticAiRunner()
    async for ev in runner.run(plan):
        events.append(ev)

    text = "".join(d["delta"] for kind, d in events if kind == "text")
    assert "chất lượng" in text or "Thiên hướng overlay" in text
    assert "mua ngay" not in text.lower()


@pytest.mark.asyncio
async def test_validator_exhaustion_still_safe(llm_env, monkeypatch):
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)

    async def always_exhausted(self, prompt, model_settings=None):
        raise UnexpectedModelBehavior("exhausted")

    monkeypatch.setattr(Agent, "run", always_exhausted)
    events: list[tuple[str, dict]] = []
    runner = PydanticAiRunner()
    async for ev in runner.run(plan):
        events.append(ev)
    text = "".join(d["delta"] for kind, d in events if kind == "text")
    assert "mua ngay" not in text.lower()
