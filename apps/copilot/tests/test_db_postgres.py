"""Optional Postgres session store tests (POSTGRES_TEST_URL or testcontainers)."""

from __future__ import annotations

import os

import pytest

from cryptosignal_copilot.config import sqlite_url_for_path
from cryptosignal_copilot.schema import SessionChartContext
from cryptosignal_copilot.sessions_store import SessionsStore


@pytest.fixture(scope="module")
def postgres_database_url() -> str:
    explicit = os.environ.get("POSTGRES_TEST_URL", "").strip()
    if explicit:
        return explicit
    if os.environ.get("COPILOT_USE_TESTCONTAINERS", "").lower() not in {"1", "true", "yes"}:
        pytest.skip("Postgres tests require POSTGRES_TEST_URL or COPILOT_USE_TESTCONTAINERS=1")
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:16-alpine") as postgres:
        url = postgres.get_connection_url().replace("postgresql://", "postgresql+psycopg://")
        yield url


def test_sessions_round_trip_postgres(postgres_database_url: str):
    store = SessionsStore(database_url=postgres_database_url, run_migrations=True)
    chart = SessionChartContext(
        symbol="ETHUSDT",
        interval="15m",
        from_=1,
        to=2,
        candle_count=10,
    )
    created = store.create_session(title="pg", model_id="m", chart=chart)
    loaded = store.get_session(created.id)
    assert loaded.title == "pg"
    store.delete_session(created.id)


def test_sqlite_url_helper(tmp_path):
    path = tmp_path / "nested" / "sessions.sqlite3"
    url = sqlite_url_for_path(path)
    assert url.startswith("sqlite:///")
    store = SessionsStore(database_url=url, run_migrations=True)
    assert store.has_reasoning_effort_column()
