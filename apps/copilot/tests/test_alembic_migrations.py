from __future__ import annotations

from alembic import command
from sqlalchemy import create_engine, inspect

from cryptosignal_copilot.config import sqlite_url_for_path
from cryptosignal_copilot.db.migrate import alembic_config


def test_alembic_upgrade_uses_database_url_not_ini_placeholder(monkeypatch, tmp_path):
    db = tmp_path / "alembic-test.sqlite3"
    url = sqlite_url_for_path(db)
    monkeypatch.setenv("DATABASE_URL", url)

    ini = alembic_config()
    assert ini.get_main_option("sqlalchemy.url") == url

    command.upgrade(ini, "head")

    engine = create_engine(url)
    inspector = inspect(engine)
    assert "copilot_sessions" in inspector.get_table_names()
    cols = {c["name"] for c in inspector.get_columns("copilot_sessions")}
    assert "reasoning_effort" in cols
