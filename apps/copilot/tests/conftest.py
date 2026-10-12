from __future__ import annotations

import pytest

from cryptosignal_copilot.config import DEFAULT_LLM_MODEL, LlmConfig
from cryptosignal_copilot.model_catalog import ModelsCatalog


async def _default_test_models(_cfg: LlmConfig):
    return [
        {
            "id": "deepseek-chat",
            "owned_by": "deepseek",
            "context_length": 64000,
            "max_output_tokens": 8192,
            "status": "active",
        },
        {
            "id": "agentrouter/deepseek-v4-flash",
            "owned_by": "agentrouter",
            "root": "deepseek-v4-flash",
            "context_length": 1_000_000,
            "max_output_tokens": 384_000,
            "status": "active",
            "capabilities": {
                "reasoning": True,
                "effort_tiers": ["none", "low", "medium", "high", "xhigh", "max"],
            },
        },
        {
            "id": "combo/auto-router",
            "owned_by": "combo",
            "status": "inactive",
        },
    ]


@pytest.fixture
def llm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_MODEL", DEFAULT_LLM_MODEL)


@pytest.fixture
def test_models_catalog() -> ModelsCatalog:
    catalog = ModelsCatalog(fetch_models=_default_test_models)
    catalog.clear_cache()
    return catalog


@pytest.fixture
def test_app(test_models_catalog, tmp_path, monkeypatch):
    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.model_catalog import ModelsCatalog
    from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests

    db = tmp_path / "sessions.sqlite3"
    store = reset_sessions_store_for_tests(db)
    catalog = ModelsCatalog(fetch_models=_default_test_models)
    catalog.clear_cache()

    def _factory(runner):
        return create_app(runner=runner, models_catalog=catalog, sessions_store=store)

    return _factory
