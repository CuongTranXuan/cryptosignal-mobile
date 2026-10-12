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
    assert model.request_max_tokens == 16_384
    assert model.recommended_candles == 100
    assert model.recommended_max_candles == 500
    assert model.supports_reasoning is True
    assert model.source == "provider"


def test_combo_route_marked_advanced():
    model = normalize_model_row({"id": "combo/foo", "owned_by": "combo"})
    assert model.advanced is True


def test_bare_openai_defaults_unknown():
    model = normalize_model_row({"id": "custom-unknown-model", "owned_by": "openai"})
    assert model.context_window == 32_000
    assert model.source == "default"
    assert model.supports_reasoning is True


@pytest.mark.asyncio
async def test_models_endpoint_and_cache_single_fetch(llm_env, test_app):
    calls = 0

    async def counting_fetch(cfg):
        nonlocal calls
        calls += 1
        return await _default_test_models(cfg)

    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.sessions_store import SessionsStore

    catalog = ModelsCatalog(fetch_models=counting_fetch)
    app = create_app(runner=FakeRunner(), models_catalog=catalog, sessions_store=SessionsStore())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.get("/v1/copilot/models")
        second = await client.get("/v1/copilot/models")
    assert first.status_code == 200
    body = first.json()
    assert body["default_model"] == "agentrouter/deepseek-v4-flash"
    ids = {m["id"] for m in body["models"]}
    assert "agentrouter/deepseek-v4-flash" in ids
    assert len(ids) == 4
    assert second.status_code == 200
    assert calls == 1
