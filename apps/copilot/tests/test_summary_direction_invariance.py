from dataclasses import replace

import pytest
from pydantic_ai import Agent

from cryptosignal_copilot.agent import PydanticAiRunner
from cryptosignal_copilot.drawing_intent import AnalyzeResultLlm, CandidateDrawingIntent
from cryptosignal_copilot.intent_prep import build_intent_check, validate_analyze_intent
from cryptosignal_copilot.schema import AnalyzeIntent
from tests.test_n14_server_summary import _plan_from_fixture


@pytest.mark.asyncio
async def test_summary_direction_same_for_bullish_vs_bearish_user_bias(llm_env, monkeypatch):
    base = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)
    cid = base.candidate_catalog.candidates[0].id

    bull_req = base.request.model_copy(
        update={
            "intent": AnalyzeIntent(style="classic", bias="bullish"),
            "prompt": "bull",
        }
    )
    bear_req = base.request.model_copy(
        update={
            "intent": AnalyzeIntent(style="classic", bias="bearish"),
            "prompt": "bear",
        }
    )
    bull_intent = validate_analyze_intent(bull_req.intent)
    bear_intent = validate_analyze_intent(bear_req.intent)
    bull = replace(
        base,
        request=bull_req,
        meta={**base.meta, "intent_check": build_intent_check(bull_req, bull_intent)},
    )
    bear = replace(
        base,
        request=bear_req,
        meta={**base.meta, "intent_check": build_intent_check(bear_req, bear_intent)},
    )

    async def model_out(self, prompt, model_settings=None):
        return type(
            "RunResult",
            (),
            {
                "output": AnalyzeResultLlm(
                    pick_assessments=[],
                    drawing_intents=[CandidateDrawingIntent(candidate_id=cid)],
                )
            },
        )()

    monkeypatch.setattr(Agent, "run", model_out)

    async def analysis_for(plan):
        events = []
        runner = PydanticAiRunner()
        async for ev in runner.run(plan):
            events.append(ev)
        return next(d for k, d in events if k == "analysis")

    a1 = await analysis_for(bull)
    a2 = await analysis_for(bear)
    assert a1["summary_direction"] == a2["summary_direction"]
    assert a1["bias"] == a2["bias"]
