"""Database down: JSON 503 `db_unavailable` (retryable), `/health` reports the DB, startup
migrations retry with backoff, and a failed analyze autosave never fails the analyze."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import OperationalError

from cryptosignal_copilot.chart_state import ChartStateStore
from cryptosignal_copilot.db import migrate
from cryptosignal_copilot.db.engine import connect_args_for
from cryptosignal_copilot.sessions_store import SessionsStore
from tests.test_chart_autosave import ANALYZE_BASE, _events
from tests.test_chart_state import ScriptedRunner, _session
from tests.test_chart_state import chart_app as _chart_app_fixture

chart_app = _chart_app_fixture

DOWN_URL = "sqlite:////nonexistent-csm-dir/sessions.sqlite3"
ERRORS_FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "api_errors.json"


@pytest.fixture
def down_app(llm_env, test_models_catalog):
    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.model_probe import ModelProbeService
    from tests.probe_fixtures import all_ok_transport

    store = SessionsStore(database_url=DOWN_URL)
    return create_app(
        runner=ScriptedRunner(),
        models_catalog=test_models_catalog,
        sessions_store=store,
        chart_store=ChartStateStore(database_url=DOWN_URL),
        model_probe=ModelProbeService(test_models_catalog, transport=all_ok_transport()),
    )


def _client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_db_routes_are_503_json(down_app):
    sid = "00000000-0000-0000-0000-000000000000"
    async with _client(down_app) as client:
        responses = [
            await client.get("/v1/copilot/sessions"),
            await client.post(
                "/v1/copilot/sessions",
                json={
                    "title": "t",
                    "model_id": "agentrouter/deepseek-v4-flash",
                    "chart": {
                        "symbol": "BTCUSDT",
                        "interval": "4h",
                        "from": 1,
                        "to": 2,
                        "candle_count": 1,
                    },
                },
            ),
            await client.get(f"/v1/copilot/sessions/{sid}"),
            await client.get(f"/v1/copilot/sessions/{sid}/charts"),
            await client.get(f"/v1/copilot/sessions/{sid}/charts/BTCUSDT/4h"),
            await client.put(f"/v1/copilot/sessions/{sid}/charts/BTCUSDT/4h", json={"shapes": []}),
            await client.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid}),
        ]
    for res in responses:
        assert res.status_code == 503, res.text
        assert res.json()["code"] == "db_unavailable"
        assert res.headers["retry-after"] == "5"
    fixture = json.loads(ERRORS_FIXTURE.read_text())
    assert fixture["db_unavailable"] == {"status": 503, "body": responses[0].json()}


@pytest.mark.asyncio
async def test_analyze_without_session_still_works_when_db_is_down(down_app):
    async with _client(down_app) as client:
        res = await client.post("/v1/copilot/analyze", json=ANALYZE_BASE)
    assert res.status_code == 200
    assert _events(res.text)[-1][0] == "done"


@pytest.mark.asyncio
async def test_health_reports_the_db(down_app, chart_app):
    async with _client(down_app) as client:
        down = await client.get("/v1/copilot/health")
    async with _client(chart_app()) as client:
        up = await client.get("/v1/copilot/health")
    assert down.status_code == 503
    assert (down.json()["code"], down.json()["db"]) == ("db_unavailable", "unavailable")
    assert up.status_code == 200
    assert up.json()["db"] == "ok" and up.json()["ok"] is True


class FailingChartStore(ChartStateStore):
    def save_analysis(self, *args, **kwargs):
        raise OperationalError("UPDATE chart_states", {}, Exception("connection refused"))


@pytest.mark.asyncio
async def test_failed_autosave_keeps_the_analyze(
    llm_env, tmp_path, monkeypatch, test_models_catalog
):
    from cryptosignal_copilot.app import create_app
    from cryptosignal_copilot.config import sqlite_url_for_path
    from cryptosignal_copilot.model_probe import ModelProbeService
    from cryptosignal_copilot.sessions_store import reset_sessions_store_for_tests
    from tests.probe_fixtures import all_ok_transport

    db = tmp_path / "sessions.sqlite3"
    monkeypatch.setenv("DATABASE_URL", sqlite_url_for_path(db))
    store = reset_sessions_store_for_tests(db)
    app = create_app(
        runner=ScriptedRunner(),
        models_catalog=test_models_catalog,
        sessions_store=store,
        chart_store=FailingChartStore(database_url=store.database_url),
        model_probe=ModelProbeService(test_models_catalog, transport=all_ok_transport()),
    )
    async with _client(app) as client:
        sid = await _session(client)
        res = await client.post("/v1/copilot/analyze", json={**ANALYZE_BASE, "session_id": sid})
    assert res.status_code == 200
    events = _events(res.text)
    assert events[-1][0] == "done"
    assert events[-2][1]["chart_state_error"] == "db_unavailable"
    assert any(kind == "shapes" for kind, _ in events)


def test_startup_migrations_retry_with_backoff(monkeypatch):
    calls: list[int] = []
    sleeps: list[float] = []

    def flaky() -> None:
        calls.append(1)
        if len(calls) < 3:
            raise OperationalError("connect", {}, Exception("refused"))

    assert migrate.run_db_migrations_with_retry(migrate=flaky, sleep=sleeps.append) is True
    assert len(calls) == 3 and sleeps == [1.0, 2.0]


def test_startup_migrations_give_up_without_crashing(monkeypatch):
    monkeypatch.setenv("COPILOT_DB_STARTUP_RETRIES", "4")
    sleeps: list[float] = []

    def down() -> None:
        raise OperationalError("connect", {}, Exception("refused"))

    assert migrate.run_db_migrations_with_retry(migrate=down, sleep=sleeps.append) is False
    assert sleeps == [1.0, 2.0, 4.0]


def test_network_databases_get_a_short_connect_timeout(monkeypatch):
    monkeypatch.delenv("COPILOT_DB_CONNECT_TIMEOUT_S", raising=False)
    assert connect_args_for("postgresql+psycopg://u@h/db") == {"connect_timeout": 3}
    monkeypatch.setenv("COPILOT_DB_CONNECT_TIMEOUT_S", "7")
    assert connect_args_for("postgresql+psycopg://u@h/db") == {"connect_timeout": 7}
    assert connect_args_for("sqlite:///x.db") == {"check_same_thread": False}
