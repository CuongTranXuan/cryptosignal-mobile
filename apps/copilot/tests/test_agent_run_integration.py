import json

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

from cryptosignal_copilot.agent import INSTRUCTIONS
from cryptosignal_copilot.agent_output import build_agent_output_type, output_retries_for_model
from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.run_settings import build_run_model_settings
from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm

_VALID_JSON = json.dumps(
    {
        "pick_notes": [],
        "drawing_intents": [],
        "markers": [],
    }
)


async def _run_with_test_model(catalog_model, custom_output_text: str) -> AnalyzeResultLlm:
    test_model = TestModel(call_tools=[], custom_output_text=custom_output_text)
    settings, _ = build_run_model_settings(catalog_model)
    agent = Agent(
        test_model,
        output_type=build_agent_output_type(catalog_model),
        instructions=INSTRUCTIONS,
        retries={"output": output_retries_for_model(catalog_model)},
    )
    result = await agent.run("analyze", model_settings=settings)
    assert isinstance(result.output, AnalyzeResultLlm)
    return result.output


@pytest.mark.asyncio
async def test_agent_run_prompted_output_with_test_model():
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
    output = await _run_with_test_model(model, _VALID_JSON)
    assert output.pick_notes == []


@pytest.mark.asyncio
async def test_agent_run_text_json_fence_with_test_model(omniroute_catalog_env):
    model = normalize_model_row({"id": "cursor/composer-2.5", "owned_by": "cursor"})
    fenced = f"```json\n{_VALID_JSON}\n```"
    output = await _run_with_test_model(model, fenced)
    assert output.pick_notes == []
