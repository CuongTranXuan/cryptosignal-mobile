from pathlib import Path

from cryptosignal_copilot.config import load_database_url, sqlite_url_for_path


def test_sessions_db_fallback_to_sqlite_url(monkeypatch, tmp_path):
    db = tmp_path / "legacy.sqlite3"
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("COPILOT_SESSIONS_DB", str(db))
    assert load_database_url() == sqlite_url_for_path(db)


def test_database_url_takes_precedence(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost/db")
    monkeypatch.setenv("COPILOT_SESSIONS_DB", str(tmp_path / "ignored.sqlite3"))
    assert load_database_url() == "postgresql+psycopg://u:p@localhost/db"
