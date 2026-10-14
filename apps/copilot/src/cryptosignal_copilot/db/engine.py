from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from cryptosignal_copilot.config import load_database_url

_engine: Engine | None = None


def get_engine(database_url: str | None = None) -> Engine:
    global _engine
    if database_url is not None:
        return create_engine(
            database_url,
            pool_pre_ping=True,
            connect_args=_sqlite_connect_args(database_url),
        )
    if _engine is None:
        url = load_database_url()
        _engine = create_engine(
            url,
            pool_pre_ping=True,
            connect_args=_sqlite_connect_args(url),
        )
    return _engine


def reset_engine_for_tests() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None


def _sqlite_connect_args(url: str) -> dict[str, object]:
    if url.startswith("sqlite:"):
        return {"check_same_thread": False}
    return {}
