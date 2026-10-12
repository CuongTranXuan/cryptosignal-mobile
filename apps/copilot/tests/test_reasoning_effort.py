import pytest

from cryptosignal_copilot.analyze_prep import AnalyzePrepError, prepare_analyze
from cryptosignal_copilot.config import load_llm_config
from cryptosignal_copilot.model_catalog import ModelsCatalog
from cryptosignal_copilot.schema import AnalyzeRequest
from tests.conftest import _default_test_models


@pytest.mark.asyncio
async def test_invalid_reasoning_effort_rejected(llm_env):
    catalog = ModelsCatalog(fetch_models=_default_test_models)
    cfg = load_llm_config()
    req = AnalyzeRequest.model_validate(
        {
            "symbol": "BTCUSDT",
            "interval": "1h",
            "from": 1,
            "to": 2,
            "closedCandles": [{"time": 1, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 1}],
            "existingShapes": [],
            "prompt": "x",
            "reasoning_effort": "not-a-tier",
        }
    )
    with pytest.raises(AnalyzePrepError) as exc:
        await prepare_analyze(catalog, cfg, req)
    assert exc.value.code == "invalid_reasoning_effort"
