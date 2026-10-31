"""SQLite runs in WAL with synchronous=NORMAL and a busy timeout (copilot + autoscan writers)."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from cryptosignal_copilot.config import DatabaseConfigError, load_database_url, sqlite_url_for_path
from cryptosignal_copilot.db.engine import get_engine


def test_sqlite_connections_use_wal_normal_and_busy_timeout(tmp_path):
    engine = get_engine(sqlite_url_for_path(tmp_path / "s.sqlite3"))
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert conn.execute(text("PRAGMA synchronous")).scalar() == 1  # NORMAL
        assert conn.execute(text("PRAGMA busy_timeout")).scalar() == 5000
    engine.dispose()


def _clear_db_env(monkeypatch):
    for name in ("DATABASE_URL", "COPILOT_SESSIONS_DB", "COPILOT_DATA_DIR"):
        monkeypatch.delenv(name, raising=False)


def test_production_without_a_db_path_fails_instead_of_using_tmp(monkeypatch):
    _clear_db_env(monkeypatch)
    monkeypatch.setenv("COPILOT_ENV", "production")
    with pytest.raises(DatabaseConfigError, match="DATABASE_URL or COPILOT_DATA_DIR"):
        load_database_url()


def test_production_with_a_data_dir_is_fine(monkeypatch, tmp_path):
    _clear_db_env(monkeypatch)
    monkeypatch.setenv("COPILOT_ENV", "production")
    monkeypatch.setenv("COPILOT_DATA_DIR", str(tmp_path))
    assert load_database_url() == sqlite_url_for_path(tmp_path / "sessions.sqlite3")


def test_dev_keeps_the_tmp_fallback(monkeypatch, tmp_path):
    _clear_db_env(monkeypatch)
    monkeypatch.delenv("COPILOT_ENV", raising=False)
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    assert load_database_url() == sqlite_url_for_path(
        tmp_path / "cryptosignal-copilot-sessions.sqlite3"
    )
