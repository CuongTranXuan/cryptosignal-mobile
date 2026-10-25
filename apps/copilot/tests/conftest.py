from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from cryptosignal_copilot.config import LlmConfig, sqlite_url_for_path
from cryptosignal_copilot.model_catalog import ModelsCatalog
from tests.omniroute_fixtures import omniroute_models_payload

TEST_LLM_MODEL = "agentrouter/deepseek-v4-flash"

_OMNIROUTE_OVERRIDES = (
    Path(__file__).resolve().parents[1] / "config/omniroute.model-overrides.json.example"
)

_CATALOG_ENV_KEYS = (
    "COPILOT_MODEL_PROVIDERS",
    "COPILOT_MODEL_VISIBILITY_ALLOWLIST",
    "COPILOT_MODEL_ALLOWLIST",
    "COPILOT_MODEL_ID_PREFIX_ALIASES",
    "COPILOT_MODEL_OVERRIDES_FILE",
    "COPILOT_MODEL_OVERRIDES_JSON",
    "COPILOT_MODEL_ADVANCED_SUBSTRINGS",
    "COPILOT_MODEL_INCLUDE_COMBO",
    "COPILOT_DEFAULT_MODEL_CONTEXT",
    "COPILOT_DEFAULT_MODEL_MAX_OUTPUT",
)


def pytest_configure(config: pytest.Config) -> None:
    """Isolate session DB before any test imports app or sessions_store."""
    if os.environ.get("_COPILOT_PYTEST_DB_ISOLATED"):
        return
    base = Path(tempfile.gettempdir()) / "cryptosignal-copilot-pytest"
    base.mkdir(parents=True, exist_ok=True)
    db_path = base / f"sessions-{os.getpid()}.sqlite3"
    os.environ["DATABASE_URL"] = sqlite_url_for_path(db_path)
    os.environ.setdefault("COPILOT_RUN_DB_MIGRATIONS", "true")
    os.environ["_COPILOT_PYTEST_DB_ISOLATED"] = "1"


@pytest.fixture(autouse=True)
def isolate_model_catalog_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ignore host-exported catalog overrides unless a test fixture sets them."""
    for key in _CATALOG_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


async def _default_test_models(_cfg: LlmConfig):
    return omniroute_models_payload()


@pytest.fixture
def llm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:20128/v1")
    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_MODEL", TEST_LLM_MODEL)
    monkeypatch.setenv("COPILOT_RUN_DB_MIGRATIONS", "true")
    monkeypatch.setenv("COPILOT_SKIP_HTF", "1")


@pytest.fixture
def omniroute_catalog_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Filters + overrides matching the OmniRoute example deployment."""
    monkeypatch.setenv("COPILOT_MODEL_PROVIDERS", "agentrouter,cursor")
    monkeypatch.setenv(
        "COPILOT_MODEL_VISIBILITY_ALLOWLIST",
        "agentrouter/deepseek-v4-flash,cursor/auto,cursor/auto-balance,cursor/auto-cost,"
        "cursor/auto-intelligence,cursor/composer-2.5,cursor/composer-2.5-fast",
    )
    monkeypatch.setenv("COPILOT_MODEL_ID_PREFIX_ALIASES", "cu/:cursor/")
    monkeypatch.setenv("COPILOT_MODEL_OVERRIDES_FILE", str(_OMNIROUTE_OVERRIDES))


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

    monkeypatch.setenv("COPILOT_RUN_DB_MIGRATIONS", "true")
    monkeypatch.setenv("DATABASE_URL", sqlite_url_for_path(tmp_path / "sessions.sqlite3"))
    db = tmp_path / "sessions.sqlite3"
    store = reset_sessions_store_for_tests(db)
    catalog = ModelsCatalog(fetch_models=_default_test_models)
    catalog.clear_cache()

    def _factory(runner):
        from cryptosignal_copilot.model_probe import ModelProbeService
        from tests.probe_fixtures import all_ok_transport

        probe = ModelProbeService(catalog, transport=all_ok_transport())
        return create_app(
            runner=runner, models_catalog=catalog, sessions_store=store, model_probe=probe
        )

    return _factory
