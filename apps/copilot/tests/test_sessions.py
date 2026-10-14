import json
import sqlite3

import pytest
from httpx import ASGITransport, AsyncClient

from cryptosignal_copilot.sessions_store import SessionsStore
from tests.test_app import FakeRunner

SESSION_BODY = {
    "title": "BTC ideas",
    "model_id": "deepseek-chat",
    "reasoning_effort": "low",
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
            "markers": [
                {
                    "id": "mk1",
                    "symbol": "BTCUSDT",
                    "interval": "1h",
                    "time": 1,
                    "side": "buy",
                    "position": "aboveBar",
                    "shape": "arrowUp",
                    "confidence": 0.6,
                    "source": "agent",
                }
            ],
            "created_at": 1,
        }
    ],
}


@pytest.mark.asyncio
async def test_session_crud_round_trip_reasoning_and_markers(llm_env, test_app):
    app = test_app(FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/v1/copilot/sessions", json=SESSION_BODY)
        assert created.status_code == 200
        body = created.json()
        session_id = body["id"]
        assert body["reasoning_effort"] == "low"
        assert body["messages"][0]["markers"][0]["id"] == "mk1"

        listed = await client.get("/v1/copilot/sessions")
        assert listed.json()["sessions"][0]["reasoning_effort"] == "low"

        got = await client.get(f"/v1/copilot/sessions/{session_id}")
        assert got.json()["messages"][0]["markers"][0]["side"] == "buy"

        patched = await client.patch(
            f"/v1/copilot/sessions/{session_id}",
            json={"title": "renamed", "reasoning_effort": "medium"},
        )
        assert patched.json()["title"] == "renamed"
        assert patched.json()["reasoning_effort"] == "medium"

        cleared = await client.patch(
            f"/v1/copilot/sessions/{session_id}",
            json={"reasoning_effort": None},
        )
        assert cleared.json()["reasoning_effort"] is None

        deleted = await client.delete(f"/v1/copilot/sessions/{session_id}")
        assert deleted.json()["ok"] is True
        missing = await client.get(f"/v1/copilot/sessions/{session_id}")
        assert missing.status_code == 404


@pytest.mark.asyncio
async def test_create_soft_drops_unknown_reasoning_effort(llm_env, test_app):
    app = test_app(FakeRunner())
    body = {**SESSION_BODY, "reasoning_effort": "not-a-tier"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/v1/copilot/sessions", json=body)
    assert created.status_code == 200
    assert created.json()["reasoning_effort"] is None


def test_legacy_payload_without_new_fields(tmp_path):
    db = tmp_path / "legacy.sqlite"
    legacy_payload = {
        "id": "legacy-1",
        "title": "Old",
        "created_at": 1,
        "updated_at": 2,
        "model_id": "deepseek-chat",
        "chart": {
            "symbol": "BTCUSDT",
            "interval": "1h",
            "from": 1,
            "to": 2,
            "candle_count": 50,
        },
        "messages": [
            {
                "id": "m0",
                "role": "user",
                "content": "legacy",
                "model_id": None,
                "shapes": [],
                "created_at": 1,
            }
        ],
    }
    conn = sqlite3.connect(db)
    conn.execute(
        """
        CREATE TABLE copilot_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        INSERT INTO copilot_sessions (id, title, created_at, updated_at, payload)
        VALUES (?, ?, ?, ?, ?)
        """,
        ("legacy-1", "Old", 1.0, 2.0, json.dumps(legacy_payload)),
    )
    conn.commit()
    conn.close()

    store = SessionsStore(db_path=db, run_migrations=True)
    session = store.get_session("legacy-1")
    assert session.reasoning_effort is None
    assert session.messages[0].markers == []
    assert store.has_reasoning_effort_column()
