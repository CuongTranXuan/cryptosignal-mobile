import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import UnexpectedModelBehavior

from cryptosignal_copilot.agent import PydanticAiRunner
from tests.test_n14_server_summary import _plan_from_fixture


@pytest.mark.asyncio
async def test_server_emits_single_shapes_event(llm_env, monkeypatch):
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)

    async def always_exhausted(self, prompt, model_settings=None):
        raise UnexpectedModelBehavior("exhausted")

    monkeypatch.setattr(Agent, "run", always_exhausted)
    shape_events = []
    runner = PydanticAiRunner()
    async for kind, data in runner.run(plan):
        if kind == "shapes":
            shape_events.append(data)
    assert len(shape_events) == 1
