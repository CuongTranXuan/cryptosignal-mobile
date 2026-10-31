import pytest
from httpx import ASGITransport, AsyncClient

from tests.test_app import ANALYZE, FakeRunner

SESSION_BODY = {
    "title": "intent session",
    "model_id": "deepseek-chat",
    "chart": {
        "symbol": "BTCUSDT",
        "interval": "1h",
        "from": 1,
        "to": 100,
        "candle_count": 50,
    },
}


@pytest.mark.asyncio
async def test_session_intent_patch_get_list(llm_env, test_app):
    app = test_app(FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post(
            "/v1/copilot/sessions",
            json={
                **SESSION_BODY,
                "intent": {"style": "smc", "bias": "bullish", "requested_pattern": "bos"},
            },
        )
        assert created.status_code == 200
        session_id = created.json()["id"]
        assert created.json()["intent"]["style"] == "smc"

        patched = await client.patch(
            f"/v1/copilot/sessions/{session_id}",
            json={"intent": {"style": "classic", "requested_pattern": "trendline"}},
        )
        assert patched.status_code == 200
        assert patched.json()["intent"]["requested_pattern"] == "trendline"

        listed = await client.get("/v1/copilot/sessions")
        row = next(s for s in listed.json()["sessions"] if s["id"] == session_id)
        assert row["intent"]["style"] == "classic"

        cleared = await client.patch(
            f"/v1/copilot/sessions/{session_id}",
            json={"intent": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["intent"] is None


@pytest.mark.asyncio
async def test_session_intent_invalid_pattern_422(llm_env, test_app):
    app = test_app(FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/v1/copilot/sessions", json=SESSION_BODY)
        session_id = created.json()["id"]
        bad = await client.patch(
            f"/v1/copilot/sessions/{session_id}",
            json={"intent": {"style": "classic", "requested_pattern": "bos"}},
        )
    assert bad.status_code == 422
    assert bad.json()["code"] == "invalid_intent_pattern"


@pytest.mark.asyncio
async def test_analyze_falls_back_to_session_intent_without_mutating_session(
    llm_env, test_app, omniroute_catalog_env
):
    app = test_app(FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post(
            "/v1/copilot/sessions",
            json={
                **SESSION_BODY,
                "intent": {"style": "smc", "bias": "neutral", "requested_pattern": "fvg"},
            },
        )
        session_id = created.json()["id"]
        body = {**ANALYZE, "session_id": session_id}
        res = await client.post("/v1/copilot/analyze", json=body)
        assert res.status_code == 200
        assert '"intent_check"' in res.text
        assert '"style":"smc"' in res.text.replace(" ", "") or '"style": "smc"' in res.text

        session_after = await client.get(f"/v1/copilot/sessions/{session_id}")
        assert session_after.json()["intent"]["requested_pattern"] == "fvg"

        override = {**ANALYZE, "session_id": session_id, "intent": {"style": "classic"}}
        res2 = await client.post("/v1/copilot/analyze", json=override)
        assert res2.status_code == 200
        session_still = await client.get(f"/v1/copilot/sessions/{session_id}")
        assert session_still.json()["intent"]["requested_pattern"] == "fvg"
