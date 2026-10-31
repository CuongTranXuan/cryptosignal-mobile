"""`GET /v1/copilot/feedback/export`: the caller's own feedback by device cookie; the full
export (legacy unowned rows included) only with `Authorization: Bearer <COPILOT_ADMIN_TOKEN>`."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, update

from cryptosignal_copilot import admin
from cryptosignal_copilot.config import sqlite_url_for_path
from cryptosignal_copilot.db.models import CopilotFeedbackRow
from cryptosignal_copilot.feedback_store import FeedbackStore

EXPORT = "/v1/copilot/feedback/export"
TOKEN = "t" * 40
ERRORS_FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "api_errors.json"


@pytest.fixture
def fb_app(llm_env, tmp_path, monkeypatch):
    from cryptosignal_copilot.app import create_app
    from tests.test_app import FakeRunner

    monkeypatch.setenv("COPILOT_DEVICE_SECRET", "s" * 40)
    monkeypatch.delenv("COPILOT_DEVICE_COOKIE_OPTIONAL", raising=False)
    monkeypatch.delenv("COPILOT_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("COPILOT_ENV", raising=False)
    url = sqlite_url_for_path(tmp_path / "fb.sqlite3")
    monkeypatch.setenv("DATABASE_URL", url)
    store = FeedbackStore(database_url=url, run_migrations=True)

    def factory():
        return create_app(runner=FakeRunner(), feedback_store=store)

    factory.db_url = url  # type: ignore[attr-defined]
    return factory


def _client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _post(client: AsyncClient, drawing_id: str) -> str:
    body = {"session_id": "sess", "drawing_id": drawing_id, "action": "keep"}
    res = await client.post("/v1/copilot/feedback", json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_owner_sees_only_their_feedback(fb_app):
    app = fb_app()
    async with _client(app) as alice, _client(app) as bob:
        a1 = await _post(alice, "a1")
        a2 = await _post(alice, "a2")
        await _post(bob, "b1")
        res = await alice.get(EXPORT)
    assert res.status_code == 200
    assert sorted(r["id"] for r in res.json()["rows"]) == sorted([a1, a2])
    assert all("owner_id" not in r for r in res.json()["rows"])


@pytest.mark.asyncio
async def test_no_cookie_is_401_device_required(fb_app):
    app = fb_app()
    async with _client(app) as alice:
        await _post(alice, "a1")
    async with _client(app) as anon:
        res = await anon.get(EXPORT)
        forged = await anon.get(EXPORT, headers={"cookie": "csm_device=abc.def"})
    for r in (res, forged):
        assert r.status_code == 401
        assert r.json()["code"] == "device_required"
        assert r.json()["message"]
    fixture = json.loads(ERRORS_FIXTURE.read_text())
    assert fixture["device_required"] == {"status": 401, "body": res.json()}


@pytest.mark.asyncio
async def test_optional_mode_cookieless_export_is_still_401(fb_app, monkeypatch):
    monkeypatch.setenv("COPILOT_DEVICE_COOKIE_OPTIONAL", "1")
    async with _client(fb_app()) as anon:
        res = await anon.get(EXPORT)
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_legacy_rows_are_admin_only(fb_app, monkeypatch):
    monkeypatch.setenv("COPILOT_ADMIN_TOKEN", TOKEN)
    app = fb_app()
    async with _client(app) as alice:
        legacy = await _post(alice, "old")
        engine = create_engine(fb_app.db_url)
        with engine.begin() as conn:
            conn.execute(
                update(CopilotFeedbackRow)
                .where(CopilotFeedbackRow.id == legacy)
                .values(owner_id=None)
            )
        engine.dispose()
        own = await alice.get(EXPORT)
    async with _client(app) as ops:
        full = await ops.get(EXPORT, headers=_bearer(TOKEN))
    assert own.json()["rows"] == []
    assert [r["id"] for r in full.json()["rows"]] == [legacy]


@pytest.mark.asyncio
async def test_admin_with_the_right_token_sees_everything(fb_app, monkeypatch):
    monkeypatch.setenv("COPILOT_ADMIN_TOKEN", TOKEN)
    app = fb_app()
    async with _client(app) as alice, _client(app) as bob:
        ids = {await _post(alice, "a1"), await _post(bob, "b1")}
    async with _client(app) as ops:  # no device cookie needed
        res = await ops.get(EXPORT, headers=_bearer(TOKEN))
        limited = await ops.get(f"{EXPORT}?limit=1", headers=_bearer(TOKEN))
    assert res.status_code == 200
    assert {r["id"] for r in res.json()["rows"]} == ids
    assert len(limited.json()["rows"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [_bearer("w" * 40), _bearer(TOKEN[:-1]), {"Authorization": f"Basic {TOKEN}"}],
    ids=["wrong", "prefix", "not-bearer"],
)
async def test_wrong_token_is_403(fb_app, monkeypatch, caplog, headers):
    monkeypatch.setenv("COPILOT_ADMIN_TOKEN", TOKEN)
    caplog.set_level(logging.DEBUG)
    async with _client(fb_app()) as alice:
        await _post(alice, "a1")
        res = await alice.get(EXPORT, headers=headers)  # a valid cookie does not help
    assert res.status_code == 403
    assert res.json()["code"] == "admin_forbidden"
    assert TOKEN not in caplog.text and "w" * 40 not in caplog.text
    fixture = json.loads(ERRORS_FIXTURE.read_text())
    assert fixture["admin_forbidden"] == {"status": 403, "body": res.json()}


@pytest.mark.asyncio
async def test_no_token_configured_disables_full_export(fb_app):
    async with _client(fb_app()) as alice:
        await _post(alice, "a1")
        res = await alice.get(EXPORT, headers=_bearer(TOKEN))
        empty = await alice.get(EXPORT, headers=_bearer(""))
    for r in (res, empty):
        assert r.status_code == 403
        assert r.json()["code"] == "admin_export_disabled"
    fixture = json.loads(ERRORS_FIXTURE.read_text())
    assert fixture["admin_export_disabled"] == {"status": 403, "body": res.json()}


def test_production_refuses_a_short_token(monkeypatch):
    monkeypatch.setenv("COPILOT_ENV", "production")
    monkeypatch.setenv("COPILOT_ADMIN_TOKEN", "short-token")
    with pytest.raises(admin.AdminConfigError) as exc:
        admin.admin_token_from_env()
    assert "short-token" not in str(exc.value)
    monkeypatch.setenv("COPILOT_ADMIN_TOKEN", TOKEN)
    assert admin.admin_token_from_env() == TOKEN


def test_production_without_a_token_disables_full_export(monkeypatch):
    monkeypatch.setenv("COPILOT_ENV", "production")
    monkeypatch.delenv("COPILOT_ADMIN_TOKEN", raising=False)
    assert admin.admin_token_from_env() is None
    assert admin.check_admin("Bearer anything", None) == "admin_export_disabled"


def test_dev_allows_a_short_token(monkeypatch):
    monkeypatch.delenv("COPILOT_ENV", raising=False)
    monkeypatch.setenv("COPILOT_ADMIN_TOKEN", "dev")
    assert admin.admin_token_from_env() == "dev"
    assert admin.check_admin("Bearer dev", "dev") is None


def test_create_app_fails_on_a_short_production_token(monkeypatch):
    from cryptosignal_copilot.app import create_app
    from tests.test_app import FakeRunner

    monkeypatch.setenv("COPILOT_ENV", "production")
    monkeypatch.setenv("COPILOT_DEVICE_SECRET", "s" * 40)
    monkeypatch.setenv("COPILOT_DATA_DIR", "/tmp")
    monkeypatch.setenv("COPILOT_ADMIN_TOKEN", "x" * 31)
    with pytest.raises(admin.AdminConfigError):
        create_app(runner=FakeRunner())


def test_feedback_store_records_the_owner(tmp_path):
    from cryptosignal_copilot.schema import FeedbackAction

    store = FeedbackStore(
        database_url=sqlite_url_for_path(tmp_path / "o.sqlite3"), run_migrations=True
    )
    body = FeedbackAction(session_id="s", drawing_id="d", action="keep")
    store.create(body, owner="dev-1")
    store.create(body, owner="dev-2")
    assert len(store.export_rows(owner="dev-1")) == 1
    assert len(store.export_rows()) == 2
