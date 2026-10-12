import pytest

from cryptosignal_copilot.analyze_prep import AnalyzePrepError, prepare_analyze
from cryptosignal_copilot.config import load_llm_config
from cryptosignal_copilot.model_catalog import ModelsCatalog
from cryptosignal_copilot.schema import AnalyzeRequest
from tests.conftest import _default_test_models


def _req(**kwargs):
    base = {
        "symbol": "BTCUSDT",
        "interval": "1h",
        "from": 1,
        "to": 3,
        "closedCandles": [
            {"time": i, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 1}
            for i in range(1, 4)
        ],
        "existingShapes": [],
        "prompt": "x",
    }
    base.update(kwargs)
    return AnalyzeRequest.model_validate(base)


@pytest.mark.asyncio
async def test_unknown_model_400(llm_env, monkeypatch):
    catalog = ModelsCatalog(fetch_models=_default_test_models)
    cfg = load_llm_config()
    with pytest.raises(AnalyzePrepError) as exc:
        await prepare_analyze(catalog, cfg, _req(model="missing-model"))
    assert exc.value.code == "unknown_model"
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_clamp_candle_count(llm_env):
    catalog = ModelsCatalog(fetch_models=_default_test_models)
    cfg = load_llm_config()
    candles = [
        {"time": i, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 1}
        for i in range(600)
    ]
    plan = await prepare_analyze(
        catalog,
        cfg,
        _req(closedCandles=candles, candle_count=600, **{"from": 0, "to": 599}),
    )
    assert plan.candle_count_used == 500
    assert plan.meta["clamped"] is True
    assert len(plan.request.closedCandles) == 500
