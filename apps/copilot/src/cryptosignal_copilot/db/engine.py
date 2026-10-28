from __future__ import annotations

from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine

from cryptosignal_copilot.config import load_database_url

_engine: Engine | None = None


def get_engine(database_url: str | None = None) -> Engine:
    global _engine
    if database_url is not None:
        return _create(database_url)
    if _engine is None:
        _engine = _create(load_database_url())
    return _engine


def _create(url: str) -> Engine:
    engine = create_engine(url, pool_pre_ping=True, connect_args=_sqlite_connect_args(url))
    if url.startswith("sqlite:"):
        event.listen(engine, "connect", _sqlite_pragmas)
    return engine


SQLITE_BUSY_TIMEOUT_MS = 5000


def _sqlite_pragmas(dbapi_conn: Any, _record: Any) -> None:
    """WAL lets readers run beside the one writer; NORMAL is durable enough under WAL; the
    busy timeout makes a second writer (autoscan) wait instead of failing."""
    cursor = dbapi_conn.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
    finally:
        cursor.close()


def reset_engine_for_tests() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None


def _sqlite_connect_args(url: str) -> dict[str, object]:
    if url.startswith("sqlite:"):
        return {"check_same_thread": False}
    return {}
