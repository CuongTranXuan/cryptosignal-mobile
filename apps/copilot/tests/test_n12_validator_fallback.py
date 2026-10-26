"""N12: validator exhaustion must not stream unvalidated sycophantic text."""

from __future__ import annotations

import pytest
from pydantic_ai import Agent
from pydantic_ai import ModelRetry
from pydantic_ai.exceptions import UnexpectedModelBehavior

from cryptosignal_copilot.agent import PydanticAiRunner
from cryptosignal_copilot.agent_validate import attach_drawing_intent_validator
from cryptosignal_copilot.analyze_prep import AnalyzePlan
from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.intent_prep import build_intent_check, validate_analyze_intent
from cryptosignal_copilot.intent_step import rules_first_step
from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.output_language_validate import validate_summary_imperatives
from cryptosignal_copilot.schema import AnalyzeRequest
from tests.eval.test_chart_replay import _load_fixture


def _analyze_request(fixture: str, *, candle_count: int) -> AnalyzeRequest:
    symbol, interval, candles = _load_fixture(fixture)
    use = candles[-candle_count:]
    return AnalyzeRequest.model_validate(
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


def _plan_from_fixture(fixture: str, *, candle_count: int) -> AnalyzePlan:
    request = _analyze_request(fixture, candle_count=candle_count)
    catalog = build_candidate_catalog(
        request.closedCandles, symbol=request.symbol, interval=request.interval
    )
    assert catalog.candidates, "fixture must yield detector candidates"
    intent = validate_analyze_intent(request.intent)
    step = rules_first_step(request, catalog, intent)
    model = normalize_model_row({"id": "agentrouter/deepseek-v4-flash", "owned_by": "agentrouter"})
    meta = {
        "intent_check": build_intent_check(request, intent),
        "llm_provider": "generic",
        "raw_candidate_count": catalog.raw_candidate_count,
    }
    return AnalyzePlan(
        model_id=model.id,
        model=model,
        request=request,
        meta=meta,
        model_settings={},
        reasoning_effort=None,
        candle_count_requested=candle_count,
        candle_count_used=candle_count,
        candidate_catalog=catalog,
        intent_step=step,
    )


def test_sycophantic_phrase_blocked_before_stream() -> None:
    with pytest.raises(ModelRetry):
        validate_summary_imperatives("Tăng mạnh, mua ngay!")


@pytest.mark.asyncio
async def test_runner_fallback_after_validator_exhaustion_never_streams_bad_summary(
    llm_env, monkeypatch
):
    """Output retries exhausted on both plan attempts → server fallback, never sycophancy."""
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)
    attach_calls = 0

    def counting_attach(agent, catalog, **kwargs):
        nonlocal attach_calls
        attach_calls += 1
        assert catalog is not None
        assert catalog.raw_candidate_count > 0
        return attach_drawing_intent_validator(agent, catalog, **kwargs)

    async def always_exhausted(self, prompt, model_settings=None):
        raise UnexpectedModelBehavior("scripted: output retries exhausted")

    monkeypatch.setattr(
        "cryptosignal_copilot.agent.attach_drawing_intent_validator",
        counting_attach,
    )
    monkeypatch.setattr(Agent, "run", always_exhausted)

    events: list[tuple[str, dict]] = []
    runner = PydanticAiRunner()
    async for ev in runner.run(plan):
        events.append(ev)

    text = "".join(d["delta"] for kind, d in events if kind == "text")
    assert "mua ngay" not in text.lower()
    assert attach_calls == 2, "both plan attempts must attach output validator with catalog"
    retried_meta = [d for kind, d in events if kind == "meta" and d.get("retried")]
    assert retried_meta
    assert retried_meta[-1].get("raw_candidate_count", 0) > 0

    shape_payloads = [d for kind, d in events if kind == "shapes"]
    assert shape_payloads
    assert len(shape_payloads[0]["shapes"]) > 0
    assert "bộ phát hiện" in text or "máy chủ" in text
