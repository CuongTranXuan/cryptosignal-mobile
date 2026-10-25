"""Sessions store analyze output verbatim: shapes and anchor markers keep their wire guardrail."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from pydantic_ai import Agent

from cryptosignal_copilot.agent import PydanticAiRunner
from cryptosignal_copilot.drawing_intent import (
    AnalyzeResultLlm,
    CandidateDrawingIntent,
    PickAssessment,
)
from cryptosignal_copilot.schema import AgentMarker, SessionShape
from cryptosignal_copilot.wire_guardrail import Guardrail, Invalidation
from cryptosignal_copilot.wire_shape import WIRE_GUARDRAIL_KEYS, WIRE_INVALIDATION_KEYS
from tests.test_app import FakeRunner
from tests.test_n14_server_summary import _plan_from_fixture


def test_guardrail_model_matches_wire_keys():
    assert set(Guardrail.model_fields) == WIRE_GUARDRAIL_KEYS
    assert set(Invalidation.model_fields) == WIRE_INVALIDATION_KEYS


async def _analyze_events(monkeypatch) -> tuple[list[dict], list[dict], str]:
    plan = _plan_from_fixture("btcusdt_1h_200.json", candle_count=200)
    ids = [c.id for c in plan.candidate_catalog.candidates[:3]]

    async def scripted(self, prompt, model_settings=None):
        return type(
            "R",
            (),
            {
                "output": AnalyzeResultLlm(
                    pick_assessments=[
                        PickAssessment(candidate_id=i, quality="ok", confluence=[], touch_ack=False)
                        for i in ids
                    ],
                    drawing_intents=[CandidateDrawingIntent(candidate_id=i) for i in ids],
                )
            },
        )()

    monkeypatch.setattr(Agent, "run", scripted)
    shapes: list[dict] = []
    markers: list[dict] = []
    text: list[str] = []
    async for name, data in PydanticAiRunner().run(plan):
        if name == "shapes":
            shapes = data["shapes"]
        elif name == "markers":
            markers = data["markers"]
        elif name == "text":
            text.append(data["delta"])
    return shapes, markers, "".join(text)


@pytest.mark.asyncio
async def test_analyze_message_round_trips_through_patch(llm_env, test_app, monkeypatch):
    shapes, markers, text = await _analyze_events(monkeypatch)
    assert shapes and all("guardrail" in s for s in shapes)
    assert markers and all("guardrail" in m for m in markers)
    message = {
        "id": "msg-1",
        "role": "assistant",
        "content": text,
        "model_id": "agentrouter/deepseek-v4-flash",
        "shapes": shapes,
        "markers": markers,
        "created_at": 1,
    }
    app = test_app(FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post(
            "/v1/copilot/sessions",
            json={
                "model_id": "agentrouter/deepseek-v4-flash",
                "chart": {
                    "symbol": "BTCUSDT",
                    "interval": "1h",
                    "from": 1,
                    "to": 2,
                    "candle_count": 200,
                },
            },
        )
        assert created.status_code == 200
        sid = created.json()["id"]
        patched = await client.patch(f"/v1/copilot/sessions/{sid}", json={"messages": [message]})
        assert patched.status_code == 200, patched.text
        fetched = (await client.get(f"/v1/copilot/sessions/{sid}")).json()
    stored = fetched["messages"][0]
    assert stored["shapes"] == shapes
    assert stored["markers"] == markers


def test_session_shape_rejects_non_wire_guardrail_keys():
    base = {
        "id": "s1",
        "symbol": "BTCUSDT",
        "interval": "1h",
        "kind": "trendline",
        "name": "x",
        "status": "preview",
        "source": "agent",
        "confidence": 0.7,
        "points": [{"time": 1, "price": 1}, {"time": 2, "price": 2}],
        "priceLow": None,
        "priceHigh": None,
    }
    plain = SessionShape.model_validate(base).model_dump()
    assert "guardrail" not in plain
    good = {"regime": "range", "confidence": 0.6, "evidence_against": [], "invalidation": None}
    assert (
        SessionShape.model_validate({**base, "guardrail": good}).model_dump()["guardrail"] == good
    )
    with pytest.raises(ValidationError):
        SessionShape.model_validate({**base, "guardrail": {**good, "debug": 1}})
    with pytest.raises(ValidationError):
        AgentMarker.model_validate(
            {
                "id": "a",
                "symbol": "BTCUSDT",
                "interval": "1h",
                "time": 1,
                "side": "neutral",
                "position": "inBar",
                "shape": "circle",
                "confidence": 0.5,
                "source": "agent",
                "guardrail": {**good, "invalidation": {"price": 1, "condition": "x", "why": "y"}},
            }
        )
