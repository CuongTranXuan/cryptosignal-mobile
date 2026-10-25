import pytest
from httpx import ASGITransport, AsyncClient

from cryptosignal_copilot.model_catalog import ModelsCatalog, normalize_model_row
from tests.conftest import _default_test_models
from tests.test_app import FakeRunner


def test_normalize_omniroute_deepseek_flash():
    row = {
        "id": "agentrouter/deepseek-v4-flash",
        "owned_by": "agentrouter",
        "root": "deepseek-v4-flash",
        "context_length": 1_000_000,
        "max_output_tokens": 384_000,
        "capabilities": {
            "reasoning": True,
            "effort_tiers": ["none", "low", "medium", "high", "xhigh", "max"],
        },
    }
    model = normalize_model_row(row)
    assert model.request_max_tokens == 32_768
    assert model.recommended_candles == 100
    assert model.recommended_max_candles == 300
    assert model.supports_reasoning is True
    assert model.source == "provider"


def test_combo_route_marked_advanced():
    model = normalize_model_row({"id": "combo/foo", "owned_by": "combo"})
    assert model.advanced is True


def test_snapshot_always_includes_configured_default_model():
    from cryptosignal_copilot.config import LlmConfig
    from cryptosignal_copilot.model_catalog import snapshot_from_rows

    cfg = LlmConfig(
        style="openai",
        base_url="http://127.0.0.1/v1",
        api_key="k",
        model="acme/special",
        timeout_s=60.0,
    )
    snap = snapshot_from_rows(cfg, [], fetched_at=1.0, ttl_s=600.0)
    assert "acme/special" in snap.by_id()


def test_bare_openai_defaults_unknown():
    model = normalize_model_row({"id": "custom-unknown-model", "owned_by": "openai"})
    assert model.context_window == 32_000
    assert model.source == "default"
    assert model.supports_reasoning is True


@pytest.mark.asyncio
async def test_models_endpoint_and_cache_single_fetch(llm_env, test_app, omniroute_catalog_env):
    calls = 0

    async def counting_fetch(cfg):
        nonlocal calls
        calls += 1
        return await _default_test_models(cfg)

    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.sessions_store import get_sessions_store

    catalog = ModelsCatalog(fetch_models=counting_fetch)
    app = create_app(
        runner=FakeRunner(),
        models_catalog=catalog,
        sessions_store=get_sessions_store(),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.get("/v1/copilot/models")
        second = await client.get("/v1/copilot/models")
    assert first.status_code == 200
    body = first.json()
    assert body["default_model"] == "agentrouter/deepseek-v4-flash"
    ids = {m["id"] for m in body["models"]}
    assert "agentrouter/deepseek-v4-flash" in ids
    from cryptosignal_copilot.model_visibility import load_visibility_allowlist

    assert ids == set(load_visibility_allowlist())
    assert second.status_code == 200
    assert calls == 1
