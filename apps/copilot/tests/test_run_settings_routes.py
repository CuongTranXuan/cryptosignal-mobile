from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.run_settings import build_run_model_settings


def test_low_effort_uses_route_without_thinking_param():
    model = normalize_model_row(
        {
            "id": "agentrouter/deepseek-v4-flash",
            "owned_by": "agentrouter",
            "context_length": 1_000_000,
            "max_output_tokens": 384_000,
            "capabilities": {
                "reasoning": True,
                "effort_tiers": ["none", "low", "medium", "high"],
            },
            "_effort_routes": {"low": "agentrouter/deepseek-v4-flash-low"},
        }
    )
    settings, effort = build_run_model_settings(model, reasoning_effort=None)
    assert effort == "low"
    assert "thinking" not in settings
    assert settings["max_tokens"] == model.request_max_tokens
