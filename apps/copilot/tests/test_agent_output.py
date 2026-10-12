from pydantic_ai.output import PromptedOutput, TextOutput

from cryptosignal_copilot.agent_output import build_agent_output_type, output_retries_for_model
from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.schema import AnalyzeResult


def test_cursor_uses_text_json_output_and_8k_tokens():
    model = normalize_model_row({"id": "cursor/composer-2.5", "owned_by": "cursor"})
    assert model.structured_output_mode == "text_json"
    assert model.request_max_tokens == 8_192
    output_type = build_agent_output_type(model)
    assert isinstance(output_type, TextOutput)
    assert output_retries_for_model(model) == 3


def test_agentrouter_uses_prompted_output():
    model = normalize_model_row(
        {
            "id": "agentrouter/deepseek-v4-flash",
            "owned_by": "agentrouter",
            "context_length": 1_000_000,
            "max_output_tokens": 384_000,
            "capabilities": {
                "reasoning": True,
                "effort_tiers": ["none", "low"],
            },
        }
    )
    assert model.structured_output_mode == "prompted"
    output_type = build_agent_output_type(model)
    assert isinstance(output_type, PromptedOutput)
    assert output_retries_for_model(model) == 2


def test_catalog_capability_overrides_output_mode():
    model = normalize_model_row(
        {
            "id": "cursor/composer-2.5",
            "owned_by": "cursor",
            "capabilities": {"structured_output_mode": "prompted"},
        }
    )
    assert model.structured_output_mode == "prompted"
