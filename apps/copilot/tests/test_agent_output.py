from cryptosignal_copilot.agent_output import build_agent_output_type
from cryptosignal_copilot.model_catalog import normalize_model_row
from pydantic_ai.output import PromptedOutput, TextOutput


def test_cursor_uses_text_json_output_and_8k_tokens(monkeypatch, omniroute_catalog_env):
    model = normalize_model_row({"id": "cursor/composer-2.5", "owned_by": "cursor"})
    assert model.structured_output_mode == "text_json"
    assert model.request_max_tokens == 8_192
    assert isinstance(build_agent_output_type(model), TextOutput)


def test_agentrouter_uses_prompted_output(monkeypatch, omniroute_catalog_env):
    model = normalize_model_row(
        {
            "id": "agentrouter/deepseek-v4-flash",
            "owned_by": "agentrouter",
            "capabilities": {"reasoning": True},
        }
    )
    assert model.structured_output_mode == "prompted"
    assert isinstance(build_agent_output_type(model), PromptedOutput)


def test_override_text_json(monkeypatch):
    monkeypatch.setenv(
        "COPILOT_MODEL_OVERRIDES_JSON",
        '{"models":{"demo/*":{"structured_output_mode":"text_json","request_max_tokens":4096}}}',
    )
    model = normalize_model_row({"id": "demo/chat", "owned_by": "demo"})
    assert model.structured_output_mode == "text_json"
    assert model.request_max_tokens == 4096
