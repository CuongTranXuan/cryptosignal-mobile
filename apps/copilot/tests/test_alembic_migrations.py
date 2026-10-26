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


def test_alembic_head_creates_chart_states_and_downgrades(tmp_path):
    url = sqlite_url_for_path(tmp_path / "charts.sqlite3")
    ini = alembic_config(url)
    command.upgrade(ini, "head")
    inspector = inspect(create_engine(url))
    cols = {c["name"] for c in inspector.get_columns("chart_states")}
    assert cols == {
        "id",
        "session_id",
        "symbol",
        "interval",
        "revision",
        "doc",
        "updated_at",
        "analyzed_at",
    }
    uniques = [u["column_names"] for u in inspector.get_unique_constraints("chart_states")]
    assert ["session_id", "symbol", "interval"] in uniques
    fks = inspector.get_foreign_keys("chart_states")
    assert fks[0]["referred_table"] == "copilot_sessions"
    assert fks[0]["options"].get("ondelete") == "CASCADE"

    command.downgrade(ini, "20251025_0002")
    assert "chart_states" not in inspect(create_engine(url)).get_table_names()
    command.upgrade(ini, "head")  # idempotent re-upgrade
    assert "chart_states" in inspect(create_engine(url)).get_table_names()
