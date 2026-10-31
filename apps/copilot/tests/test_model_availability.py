from cryptosignal_copilot.config import LlmConfig
from cryptosignal_copilot.model_availability import filter_available_models
from cryptosignal_copilot.model_catalog import snapshot_from_rows
from tests.omniroute_fixtures import omniroute_models_payload

_VISIBILITY = {
    "agentrouter/deepseek-v4-flash",
    "cursor/auto",
    "cursor/auto-balance",
    "cursor/auto-cost",
    "cursor/auto-intelligence",
    "cursor/composer-2.5",
    "cursor/composer-2.5-fast",
}


def test_omniroute_visibility_filter_collapses_large_catalog(monkeypatch, omniroute_catalog_env):
    monkeypatch.delenv("COPILOT_MODEL_INCLUDE_COMBO", raising=False)
    rows = omniroute_models_payload()
    assert len(rows) > 1600
    filtered = filter_available_models(
        rows,
        default_model_id="agentrouter/deepseek-v4-flash",
    )
    assert {row["id"] for row in filtered} == _VISIBILITY
    flash = next(r for r in filtered if r["id"] == "agentrouter/deepseek-v4-flash")
    assert flash["_effort_routes"]["low"] == "agentrouter/deepseek-v4-flash-low"
    assert flash["_effort_routes"]["none"] == "agentrouter/no-think/deepseek-v4-flash"


def test_allowlisted_media_mislabel_kept(monkeypatch, omniroute_catalog_env):
    rows = [
        {
            "id": "cursor/composer-2.5",
            "owned_by": "cursor",
            "type": "image",
            "capabilities": {"output_modalities": ["image"]},
        },
        {"id": "cursor/veo-3", "owned_by": "cursor", "type": "video"},
    ]
    filtered = filter_available_models(rows, default_model_id="agentrouter/deepseek-v4-flash")
    ids = {row["id"] for row in filtered}
    assert "cursor/composer-2.5" in ids
    assert "cursor/veo-3" not in ids


def test_media_and_legacy_cursor_hidden(monkeypatch, omniroute_catalog_env):
    rows = [
        {"id": "aihorde/flux", "owned_by": "aihorde", "type": "image"},
        {"id": "cursor/veo-3", "owned_by": "cursor", "type": "video"},
        {"id": "cursor/composer-2", "owned_by": "cursor"},
        {"id": "agentrouter/deepseek-v4-flash", "owned_by": "agentrouter"},
    ]
    filtered = filter_available_models(rows, default_model_id="agentrouter/deepseek-v4-flash")
    assert [row["id"] for row in filtered] == ["agentrouter/deepseek-v4-flash"]


def test_cu_alias_deduped(monkeypatch, omniroute_catalog_env):
    monkeypatch.setenv(
        "COPILOT_MODEL_VISIBILITY_ALLOWLIST",
        "cursor/auto,agentrouter/deepseek-v4-flash",
    )
    rows = [
        {"id": "cu/auto", "owned_by": "cu"},
        {"id": "cursor/auto", "owned_by": "cursor"},
    ]
    filtered = filter_available_models(rows, default_model_id="agentrouter/deepseek-v4-flash")
    assert sum(1 for row in filtered if row["id"] == "cursor/auto") == 1


def test_combo_excluded_by_default(monkeypatch, omniroute_catalog_env):
    monkeypatch.delenv("COPILOT_MODEL_INCLUDE_COMBO", raising=False)
    rows = [{"id": "combo/route-0", "owned_by": "combo"}]
    filtered = filter_available_models(rows, default_model_id="agentrouter/deepseek-v4-flash")
    assert {row["id"] for row in filtered} == {"agentrouter/deepseek-v4-flash"}


def test_no_provider_filter_when_unset(monkeypatch):
    monkeypatch.delenv("COPILOT_MODEL_PROVIDERS", raising=False)
    monkeypatch.delenv("COPILOT_MODEL_VISIBILITY_ALLOWLIST", raising=False)
    rows = [
        {"id": "vendor/a", "owned_by": "vendor"},
        {"id": "other/b", "owned_by": "other"},
    ]
    filtered = filter_available_models(rows, default_model_id="vendor/a")
    assert {row["id"] for row in filtered} == {"vendor/a", "other/b"}


def test_snapshot_deepseek_request_max_tokens_cap(monkeypatch, omniroute_catalog_env):
    cfg = LlmConfig(
        style="openai",
        base_url="http://127.0.0.1:20128/v1",
        api_key="k",
        model="agentrouter/deepseek-v4-flash",
        timeout_s=60.0,
    )
    snap = snapshot_from_rows(cfg, omniroute_models_payload(), fetched_at=1.0, ttl_s=600.0)
    flash = snap.by_id()["agentrouter/deepseek-v4-flash"]
    assert flash.max_output_tokens == 384_000
    assert flash.request_max_tokens == 32_768
