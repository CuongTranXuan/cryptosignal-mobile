"""Legacy output keys (`markers: []`, `summary: ""`, `pick_notes: []`) must validate on the
first model call in both output modes, never costing an output retry."""

from __future__ import annotations

import json

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from cryptosignal_copilot.agent import INSTRUCTIONS
from cryptosignal_copilot.agent_output import build_agent_output_type, output_retries_for_model
from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm
from cryptosignal_copilot.model_catalog import normalize_model_row

BASE = {"pick_assessments": [], "drawing_intents": []}
LEGACY = [
    {"markers": []},
    {"summary": ""},
    {"pick_notes": []},
    {"markers": [], "summary": "", "pick_notes": []},
    {"summary": "Tăng mạnh", "markers": [{"time": 1}], "pick_notes": ["x"]},
]


def _model(mode: str):
    if mode == "text_json":
        return normalize_model_row({"id": "cursor/composer-2.5", "owned_by": "cursor"})
    return normalize_model_row({"id": "agentrouter/deepseek-v4-flash", "owned_by": "agentrouter"})


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["prompted", "text_json"])
@pytest.mark.parametrize("extra", LEGACY, ids=lambda e: "+".join(e))
async def test_legacy_keys_validate_on_first_call(mode, extra, omniroute_catalog_env):
    catalog_model = _model(mode)
    assert catalog_model.structured_output_mode == mode
    calls = 0

    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        return ModelResponse(parts=[TextPart(json.dumps({**BASE, **extra}))])

    agent = Agent(
        FunctionModel(respond),
        output_type=build_agent_output_type(catalog_model),
        instructions=INSTRUCTIONS,
        retries={"output": output_retries_for_model(catalog_model)},
    )
    result = await agent.run("analyze")
    assert isinstance(result.output, AnalyzeResultLlm)
    assert result.output.drawing_intents == []
    assert calls == 1


def test_unknown_non_legacy_key_still_rejected():
    with pytest.raises(ValueError):
        AnalyzeResultLlm.model_validate({**BASE, "shapes_free_text": "x"})
