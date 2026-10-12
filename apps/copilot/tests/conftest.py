from __future__ import annotations

import pytest

from cryptosignal_copilot.config import DEFAULT_LLM_MODEL, LlmConfig
from cryptosignal_copilot.model_catalog import ModelsCatalog
from tests.omniroute_fixtures import omniroute_models_payload


async def _default_test_models(_cfg: LlmConfig):
    return omniroute_models_payload()


@pytest.fixture
def llm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:20128/v1")
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
