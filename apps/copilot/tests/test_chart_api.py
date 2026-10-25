import pytest
from httpx import ASGITransport, AsyncClient

from cryptosignal_copilot.feedback_store import FeedbackStore
from cryptosignal_copilot.schema import FeedbackAction


@pytest.mark.asyncio
async def test_styles_endpoint(llm_env, test_app):
    from tests.test_app import FakeRunner

    app = test_app(FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/v1/copilot/styles")
    assert res.status_code == 200
    body = res.json()
    assert "styles" in body
    classic = next(s for s in body["styles"] if s["id"] == "classic")
    assert any(p["id"] == "trendline" for p in classic["patterns"])


@pytest.mark.asyncio
async def test_feedback_post_201(llm_env, test_app, tmp_path, monkeypatch):
    db = tmp_path / "fb.sqlite"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db}")
    store = FeedbackStore(database_url=f"sqlite:///{db}", run_migrations=True)
    from cryptosignal_copilot.app import create_app
    from tests.test_app import FakeRunner

    app = create_app(runner=FakeRunner(), feedback_store=store)
    body = FeedbackAction(
        session_id="sess-1",
        drawing_id="drw_abc",
        action="keep",
        client_ts=1.0,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/v1/copilot/feedback", json=body.model_dump())
    assert res.status_code == 201
    assert res.json()["id"]
