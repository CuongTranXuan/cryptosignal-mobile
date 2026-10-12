from cryptosignal_copilot.model_availability import filter_available_models


def _large_provider_list(active_ids: set[str]) -> list[dict]:
    rows: list[dict] = []
    for i in range(1626):
        model_id = f"agentrouter/model-{i}"
        rows.append(
            {
                "id": model_id,
                "owned_by": "agentrouter",
                "status": "active" if model_id in active_ids else "inactive",
            }
        )
    rows.append({"id": "combo/router", "owned_by": "combo", "status": "inactive"})
    return rows


def test_provider_status_signal_filters_large_catalog(monkeypatch):
    active = {
        "agentrouter/model-1",
        "agentrouter/model-42",
        "agentrouter/model-99",
        "agentrouter/deepseek-v4-flash",
    }
    rows = _large_provider_list(active)
    filtered = filter_available_models(rows, default_model_id="agentrouter/deepseek-v4-flash")
    assert len(filtered) == 4
    assert {row["id"] for row in filtered} == active


def test_allowlist_overrides_when_no_status_signal(monkeypatch):
    monkeypatch.setenv("COPILOT_MODEL_ALLOWLIST", "agentrouter/a,agentrouter/b")
    monkeypatch.delenv("COPILOT_MODEL_PREFIXES", raising=False)
    rows = [
        {"id": "agentrouter/a", "owned_by": "agentrouter"},
        {"id": "agentrouter/b", "owned_by": "agentrouter"},
        *[{"id": f"agentrouter/model-{i}", "owned_by": "agentrouter"} for i in range(10)],
    ]
    filtered = filter_available_models(rows, default_model_id="agentrouter/deepseek-v4-flash")
    assert {row["id"] for row in filtered} == {
        "agentrouter/a",
        "agentrouter/b",
        "agentrouter/deepseek-v4-flash",
    }
