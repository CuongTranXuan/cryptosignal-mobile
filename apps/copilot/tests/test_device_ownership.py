"""Device ownership (docs/CHART_HISTORY_SPEC.md "Ownership"): the signed `csm_device`
cookie scopes sessions, chart history and analyze to the device that created them."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, update

from cryptosignal_copilot import device
from cryptosignal_copilot.db.models import CopilotSessionRow
from tests.test_chart_autosave import ANALYZE_BASE
from tests.test_chart_state import MIXED_DOC, SESSION, _session, _url
from tests.test_chart_state import chart_app as _chart_app_fixture

chart_app = _chart_app_fixture

SECRET = "s" * 40
ERRORS_FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "api_errors.json"


@pytest.fixture(autouse=True)
def device_env(monkeypatch):
    monkeypatch.setenv("COPILOT_DEVICE_SECRET", SECRET)
    monkeypatch.delenv("COPILOT_DEVICE_COOKIE_OPTIONAL", raising=False)
    monkeypatch.delenv("COPILOT_ENV", raising=False)


def _client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def test_token_round_trip_and_tamper():
    device_id, token = device.issue_token(SECRET.encode())
    assert device.verify_token(SECRET.encode(), token) == device_id
    assert device.verify_token(b"x" * 40, token) is None
    assert device.verify_token(SECRET.encode(), "other." + token.split(".")[1]) is None
    assert device.verify_token(SECRET.encode(), "garbage") is None
    assert device.verify_token(SECRET.encode(), None) is None


def test_production_requires_a_secret(monkeypatch):
    monkeypatch.setenv("COPILOT_ENV", "production")
    monkeypatch.delenv("COPILOT_DEVICE_SECRET")
    with pytest.raises(device.DeviceConfigError):
        device.device_settings_from_env()


def test_short_secret_and_prod_optional_refused(monkeypatch):
    monkeypatch.setenv("COPILOT_DEVICE_SECRET", "short")
    with pytest.raises(device.DeviceConfigError):
        device.device_settings_from_env()
    monkeypatch.setenv("COPILOT_DEVICE_SECRET", SECRET)
    monkeypatch.setenv("COPILOT_ENV", "production")
    monkeypatch.setenv("COPILOT_DEVICE_COOKIE_OPTIONAL", "1")
    with pytest.raises(device.DeviceConfigError):
        device.device_settings_from_env()


def test_dev_secret_is_generated_and_stable(monkeypatch, tmp_path):
    monkeypatch.delenv("COPILOT_DEVICE_SECRET")
    monkeypatch.setattr(device.tempfile, "gettempdir", lambda: str(tmp_path))
    first = device.device_settings_from_env()
    second = device.device_settings_from_env()
    assert len(first.secret) >= device.MIN_SECRET_LEN
    assert first.secret == second.secret
    assert (first.cookie_optional, first.secure) == (False, False)


def test_production_cookie_is_secure(monkeypatch):
    monkeypatch.setenv("COPILOT_ENV", "production")
    assert device.device_settings_from_env().secure is True


@pytest.mark.asyncio
async def test_cookie_issued_once_with_attributes(chart_app):
    async with _client(chart_app()) as client:
        first = await client.get("/v1/copilot/sessions")
        second = await client.get("/v1/copilot/sessions")
    cookie = first.headers["set-cookie"]
    assert cookie.startswith("csm_device=")
    for attr in ("HttpOnly", "SameSite=Lax", "Path=/;"):
        assert attr in cookie
    assert "Secure" not in cookie
    assert "set-cookie" not in second.headers


@pytest.mark.asyncio
async def test_health_sets_no_cookie_outside_api_prefix(chart_app):
    async with _client(chart_app()) as client:
        res = await client.get("/health")
    assert "set-cookie" not in res.headers


@pytest.mark.asyncio
async def test_sessions_are_scoped_to_the_device(chart_app):
    app = chart_app()
    async with _client(app) as alice, _client(app) as bob:
        sid = await _session(alice)
        assert (await alice.put(_url(sid), json=MIXED_DOC)).status_code == 200
        await _session(bob)

        alice_ids = [s["id"] for s in (await alice.get("/v1/copilot/sessions")).json()["sessions"]]
        bob_ids = [s["id"] for s in (await bob.get("/v1/copilot/sessions")).json()["sessions"]]
        assert alice_ids == [sid]
        assert sid not in bob_ids and len(bob_ids) == 1

        base = f"/v1/copilot/sessions/{sid}"
        foreign = [
            await bob.get(base),
            await bob.patch(base, json={"title": "x"}),
            await bob.delete(base),
            await bob.get(f"{base}/charts"),
            await bob.get(_url(sid)),
            await bob.put(_url(sid), json=MIXED_DOC),
            await bob.delete(_url(sid)),
            await bob.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid}),
        ]
        assert [r.status_code for r in foreign] == [404] * len(foreign)
        assert all(
            r.json() == {"error": "session not found", "code": "session_not_found"} for r in foreign
        )

        fixture = json.loads(ERRORS_FIXTURE.read_text())
        assert fixture["session_not_found"] == {"status": 404, "body": foreign[0].json()}

        # Untouched for the owner.
        assert (await alice.get(base)).json()["title"] == SESSION["title"]
        assert (await alice.get(_url(sid))).status_code == 200


@pytest.mark.asyncio
async def test_missing_cookie_is_a_new_device(chart_app):
    app = chart_app()
    async with _client(app) as alice:
        sid = await _session(alice)
    async with _client(app) as anon:
        res = await anon.get(f"/v1/copilot/sessions/{sid}")
    assert res.status_code == 404
    assert "csm_device=" in res.headers["set-cookie"]


@pytest.mark.asyncio
async def test_forged_cookie_is_a_new_device(chart_app):
    app = chart_app()
    async with _client(app) as alice:
        sid = await _session(alice)
        owner_token = alice.cookies["csm_device"]
    forged = owner_token.split(".")[0] + ".AAAA"
    async with _client(app) as mallory:
        mallory.cookies.set("csm_device", forged)
        res = await mallory.get(f"/v1/copilot/sessions/{sid}")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_optional_mode_serves_cookieless_requests_unscoped(chart_app, monkeypatch):
    monkeypatch.setenv("COPILOT_DEVICE_COOKIE_OPTIONAL", "1")
    app = chart_app()
    async with _client(app) as alice:
        sid = await _session(alice)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as proxy:
        # A proxy that drops cookies: every request arrives cookie-less.
        proxy.cookies.clear()
        res = await proxy.get(f"/v1/copilot/sessions/{sid}", headers={"cookie": ""})
    assert res.status_code == 200
    assert "csm_device=" in res.headers["set-cookie"]


@pytest.mark.asyncio
async def test_legacy_unowned_session_is_adopted_by_first_device(chart_app):
    app = chart_app()
    async with _client(app) as alice, _client(app) as bob:
        sid = await _session(alice)
        engine = create_engine(chart_app.db_url)
        with engine.begin() as conn:
            conn.execute(
                update(CopilotSessionRow).where(CopilotSessionRow.id == sid).values(owner_id=None)
            )
        engine.dispose()
        # Unowned sessions are not listed, but the first device to open one adopts it.
        assert (await bob.get("/v1/copilot/sessions")).json()["sessions"] == []
        assert (await bob.get(f"/v1/copilot/sessions/{sid}")).status_code == 200
        assert (await alice.get(f"/v1/copilot/sessions/{sid}")).status_code == 404
        listed = (await bob.get("/v1/copilot/sessions")).json()["sessions"]
        assert [s["id"] for s in listed] == [sid]


@pytest.mark.asyncio
async def test_eviction_is_per_device(chart_app, monkeypatch):
    from cryptosignal_copilot import sessions_store

    monkeypatch.setattr(sessions_store, "MAX_SESSIONS", 2)
    app = chart_app()
    async with _client(app) as alice, _client(app) as bob:
        keep = await _session(alice)
        for _ in range(3):
            await _session(bob)
        assert (await alice.get(f"/v1/copilot/sessions/{keep}")).status_code == 200
        assert len((await bob.get("/v1/copilot/sessions")).json()["sessions"]) == 2


@pytest.mark.asyncio
async def test_patch_keeps_the_owner(chart_app):
    app = chart_app()
    async with _client(app) as alice, _client(app) as bob:
        sid = await _session(alice)
        assert (await alice.patch(f"/v1/copilot/sessions/{sid}", json={"title": "y"})).is_success
        assert (await bob.get(f"/v1/copilot/sessions/{sid}")).status_code == 404
        assert (await alice.get(f"/v1/copilot/sessions/{sid}")).json()["title"] == "y"
