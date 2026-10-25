import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import UnexpectedModelBehavior

from cryptosignal_copilot.agent import PydanticAiRunner
from tests.test_n14_server_summary import _plan_from_fixture


@pytest.mark.asyncio
async def test_final_meta_emitted_with_validator_fallback(llm_env, monkeypatch):
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)

    async def always_exhausted(self, prompt, model_settings=None):
        raise UnexpectedModelBehavior("exhausted")

    monkeypatch.setattr(Agent, "run", always_exhausted)

    events: list[tuple[str, dict]] = []
    runner = PydanticAiRunner()
    async for ev in runner.run(plan):
        events.append(ev)

    kinds = [k for k, _ in events]
    assert kinds[-1] == "done"
    assert kinds[-2] == "meta"
    final_meta = events[-2][1]
    assert final_meta.get("validator_fallback") is True
    assert final_meta.get("intent_budget_fallback") is not True
