from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.run_settings import build_run_model_settings, lower_reasoning_effort


def test_deepseek_v4_flash_uses_low_effort_and_16k_cap():
    model = normalize_model_row(
        {
            "id": "agentrouter/deepseek-v4-flash",
            "owned_by": "agentrouter",
            "root": "deepseek-v4-flash",
            "context_length": 1_000_000,
            "max_output_tokens": 384_000,
            "capabilities": {"reasoning": True, "effort_tiers": ["none", "low", "medium", "high"]},
        }
    )
    settings, effort = build_run_model_settings(model)
    assert settings["max_tokens"] == 16_384
    assert effort == "low"
    assert settings["thinking"] == "low"


def test_lower_reasoning_effort_low_to_none():
    model = normalize_model_row(
        {
            "id": "agentrouter/deepseek-v4-flash",
            "owned_by": "agentrouter",
            "capabilities": {"reasoning": True, "effort_tiers": ["none", "low"]},
        }
    )
    assert lower_reasoning_effort("low", model) == "none"
