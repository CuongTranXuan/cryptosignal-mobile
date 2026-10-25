from cryptosignal_copilot.analyze_prep import AnalyzePlan, retry_plan
from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.intent_prep import validate_analyze_intent
from cryptosignal_copilot.intent_step import rules_first_step
from cryptosignal_copilot.model_catalog import normalize_model_row
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


def test_retry_plan_rebuilds_candidate_catalog(llm_env):
    request = _analyze_request("btcusdt_1h_200.json", candle_count=200)
    catalog = build_candidate_catalog(
        request.closedCandles, symbol=request.symbol, interval=request.interval
    )
    assert catalog.raw_candidate_count > 0
    intent = validate_analyze_intent(request.intent)
    step = rules_first_step(request, catalog, intent)
    model = normalize_model_row({"id": "agentrouter/deepseek-v4-flash", "owned_by": "agentrouter"})
    plan = AnalyzePlan(
        model_id=model.id,
        model=model,
        request=request,
        meta={"llm_provider": "generic", "intent_check": {}},
        model_settings={},
        reasoning_effort=None,
        candle_count_requested=200,
        candle_count_used=200,
        candidate_catalog=catalog,
        intent_step=step,
    )
    retried = retry_plan(plan)
    assert retried is not None
    assert retried.candidate_catalog is not None
    assert retried.intent_step is not None
    assert retried.candidate_catalog.raw_candidate_count > 0
    assert retried.meta.get("raw_candidate_count", 0) > 0
