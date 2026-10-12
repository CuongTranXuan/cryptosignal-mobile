from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.model_routes import parse_route_id, resolve_provider_model_id


def test_parse_route_id_variants():
    assert parse_route_id("agentrouter/deepseek-v4-flash-low") == (
        "agentrouter/deepseek-v4-flash",
        "low",
    )
    assert parse_route_id("agentrouter/no-think/deepseek-v4-flash") == (
        "agentrouter/deepseek-v4-flash",
        "none",
    )


def test_resolve_provider_model_id_prefers_effort_route():
    model = normalize_model_row(
        {
            "id": "agentrouter/deepseek-v4-flash",
            "owned_by": "agentrouter",
            "_effort_routes": {
                "low": "agentrouter/deepseek-v4-flash-low",
                "none": "agentrouter/no-think/deepseek-v4-flash",
            },
        }
    )
    assert resolve_provider_model_id(model, "low") == "agentrouter/deepseek-v4-flash-low"
    assert resolve_provider_model_id(model, "none") == "agentrouter/no-think/deepseek-v4-flash"
    assert resolve_provider_model_id(model, "medium") == "agentrouter/deepseek-v4-flash"
