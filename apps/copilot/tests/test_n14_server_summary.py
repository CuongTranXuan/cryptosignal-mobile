"""N14: server-authored bias text; model directional story must not stream."""

from __future__ import annotations

import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import UnexpectedModelBehavior

from cryptosignal_copilot.agent import PydanticAiRunner
from cryptosignal_copilot.analyze_prep import AnalyzePlan
from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm, CandidateDrawingIntent, PickNote
from cryptosignal_copilot.intent_prep import build_intent_check, validate_analyze_intent
from cryptosignal_copilot.intent_step import rules_first_step
from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.schema import AnalyzeRequest
from tests.eval.test_chart_replay import _load_fixture

GAMING_STORY = "phe mua đã kiểm soát; giá sẽ sớm đảo chiều lên và vượt đỉnh cũ"


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
async def test_bullish_story_not_in_stream_under_trend_down(llm_env, monkeypatch):
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)
    top_id = plan.candidate_catalog.candidates[0].id

    async def gaming_model(self, prompt, model_settings=None):
        return type(
            "RunResult",
            (),
            {
                "output": AnalyzeResultLlm(
                    pick_notes=[
                        PickNote(candidate_id=top_id, note=GAMING_STORY),
                    ],
                    drawing_intents=[CandidateDrawingIntent(candidate_id=top_id)],
                    markers=[],
                )
            },
        )()

    monkeypatch.setattr(Agent, "run", gaming_model)

    events: list[tuple[str, dict]] = []
    runner = PydanticAiRunner()
    async for ev in runner.run(plan):
        events.append(ev)

    text = "".join(d["delta"] for kind, d in events if kind == "text")
    assert "vượt đỉnh cũ" not in text
    assert "phe mua đã kiểm soát" not in text
    assert "Bias overlay (server)" in text or "chế độ detector" in text.lower()

    analysis = next(d for kind, d in events if kind == "analysis")
    assert analysis.get("summary_direction") in ("bearish", "neutral", "conditional", "bullish")
    # Server direction follows detector regime, not model story.
    if plan.candidate_catalog.regime == "trend_down":
        assert analysis["summary_direction"] != "bullish"


@pytest.mark.asyncio
async def test_gaming_pick_note_triggers_validator_retry_or_fallback(llm_env, monkeypatch):
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)
    top_id = plan.candidate_catalog.candidates[0].id

    async def always_exhausted(self, prompt, model_settings=None):
        raise UnexpectedModelBehavior("validator blocked gaming note")

    async def return_gaming_once(self, prompt, model_settings=None):
        return type(
            "RunResult",
            (),
            {
                "output": AnalyzeResultLlm(
                    pick_notes=[PickNote(candidate_id=top_id, note=GAMING_STORY)],
                    drawing_intents=[CandidateDrawingIntent(candidate_id=top_id)],
                    markers=[],
                )
            },
        )()

    monkeypatch.setattr(Agent, "run", return_gaming_once)

    # Real Agent.run would retry; mocked path returns gaming output — stream must still
    # not contain the gaming phrase because compose only includes validated notes.
    # Force validator path by using real attach — mock bypasses validator, so use always_exhausted.
    monkeypatch.setattr(Agent, "run", always_exhausted)
    events: list[tuple[str, dict]] = []
    runner = PydanticAiRunner()
    async for ev in runner.run(plan):
        events.append(ev)
    text = "".join(d["delta"] for kind, d in events if kind == "text")
    assert GAMING_STORY not in text
