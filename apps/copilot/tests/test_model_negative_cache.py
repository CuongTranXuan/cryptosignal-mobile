import time

from cryptosignal_copilot.model_catalog import snapshot_from_rows
from cryptosignal_copilot.config import LlmConfig
from cryptosignal_copilot.model_negative_cache import (
    ModelNegativeCache,
    reset_model_negative_cache_for_tests,
)
from tests.omniroute_fixtures import omniroute_models_payload


def test_negative_cache_hides_model_from_snapshot():
    cache = reset_model_negative_cache_for_tests(ModelNegativeCache(ttl_s=120.0))
    cfg = LlmConfig(
        style="openai",
        base_url="http://127.0.0.1:20128/v1",
        api_key="k",
        model="agentrouter/deepseek-v4-flash",
        timeout_s=60.0,
    )
    rows = omniroute_models_payload()
    before = snapshot_from_rows(cfg, rows, fetched_at=1.0, ttl_s=600.0)
    assert "agentrouter/deepseek-v4-flash" in before.by_id()

    cache.mark("agentrouter/deepseek-v4-flash")
    after = snapshot_from_rows(cfg, rows, fetched_at=1.0, ttl_s=600.0)
    assert "agentrouter/deepseek-v4-flash" not in after.by_id()


def test_negative_cache_expires():
    cache = reset_model_negative_cache_for_tests(ModelNegativeCache(ttl_s=0.05))
    cache.mark("cursor/auto")
    assert cache.is_blocked("cursor/auto")
    time.sleep(0.06)
    assert not cache.is_blocked("cursor/auto")
