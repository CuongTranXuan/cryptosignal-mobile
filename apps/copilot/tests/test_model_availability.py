from cryptosignal_copilot.model_availability import filter_available_models
from cryptosignal_copilot.model_catalog import snapshot_from_rows
from cryptosignal_copilot.config import LlmConfig
from tests.omniroute_fixtures import omniroute_models_payload


def test_omniroute_provider_filter_collapses_large_catalog(monkeypatch):
    monkeypatch.delenv("COPILOT_MODEL_ALLOWLIST", raising=False)
    monkeypatch.delenv("COPILOT_MODEL_INCLUDE_COMBO", raising=False)
    rows = omniroute_models_payload()
    assert len(rows) > 1600
    filtered = filter_available_models(
        rows,
        default_model_id="agentrouter/deepseek-v4-flash",
    )
    assert len(filtered) == 4
    assert {row["id"] for row in filtered} == {
        "agentrouter/claude-opus-4-8",
        "agentrouter/claude-opus-5",
        "agentrouter/deepseek-v4-flash",
        "agentrouter/gpt-6-astra",
    }
    flash = next(r for r in filtered if r["id"] == "agentrouter/deepseek-v4-flash")
    assert flash["_effort_routes"]["low"] == "agentrouter/deepseek-v4-flash-low"
    assert flash["_effort_routes"]["none"] == "agentrouter/no-think/deepseek-v4-flash"


def test_allowlist_restricts_canonical_ids(monkeypatch):
    monkeypatch.setenv(
        "COPILOT_MODEL_ALLOWLIST",
        "agentrouter/deepseek-v4-flash,agentrouter/gpt-6-astra",
    )
    rows = omniroute_models_payload()
    filtered = filter_available_models(rows, default_model_id="agentrouter/deepseek-v4-flash")
    assert {row["id"] for row in filtered} == {
        "agentrouter/deepseek-v4-flash",
        "agentrouter/gpt-6-astra",
    }


def test_combo_included_when_enabled(monkeypatch):
    monkeypatch.setenv("COPILOT_MODEL_INCLUDE_COMBO", "true")
    rows = [{"id": "combo/route-0", "owned_by": "combo"}]
    filtered = filter_available_models(rows, default_model_id="agentrouter/deepseek-v4-flash")
    assert filtered[0]["id"] == "combo/route-0"


def test_snapshot_keeps_request_max_tokens_cap(monkeypatch):
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
    assert flash.request_max_tokens == 16_384
