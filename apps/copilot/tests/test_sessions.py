import pytest
from httpx import ASGITransport, AsyncClient

from tests.test_app import FakeRunner


SESSION_BODY = {
    "title": "BTC ideas",
    "model_id": "deepseek-chat",
    "chart": {
        "symbol": "BTCUSDT",
        "interval": "1h",
        "from": 1,
        "to": 100,
        "candle_count": 200,
    },
    "messages": [
        {
            "id": "m1",
            "role": "user",
            "content": "hello",
            "model_id": None,
            "shapes": [],
            "created_at": 1,
        }
    ],
}


@pytest.mark.asyncio
async def test_session_crud(llm_env, test_app):
    app = test_app(FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/v1/copilot/sessions", json=SESSION_BODY)
        assert created.status_code == 200
        session_id = created.json()["id"]
        listed = await client.get("/v1/copilot/sessions")
        assert listed.json()["sessions"][0]["id"] == session_id
        got = await client.get(f"/v1/copilot/sessions/{session_id}")
        assert got.json()["model_id"] == "deepseek-chat"
        patched = await client.patch(
            f"/v1/copilot/sessions/{session_id}",
            json={"title": "renamed"},
        )
        assert patched.json()["title"] == "renamed"
        deleted = await client.delete(f"/v1/copilot/sessions/{session_id}")
        assert deleted.json()["ok"] is True
        missing = await client.get(f"/v1/copilot/sessions/{session_id}")
        assert missing.status_code == 404
