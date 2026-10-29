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
        "shape_count",
        "has_analysis",
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


def test_alembic_0004_adds_session_owner_and_downgrades(tmp_path):
    url = sqlite_url_for_path(tmp_path / "owner.sqlite3")
    ini = alembic_config(url)
    command.upgrade(ini, "head")
    inspector = inspect(create_engine(url))
    assert "owner_id" in {c["name"] for c in inspector.get_columns("copilot_sessions")}
    assert "ix_copilot_sessions_owner_id" in {
        i["name"] for i in inspector.get_indexes("copilot_sessions")
    }
    command.downgrade(ini, "20261026_0003")
    cols = {c["name"] for c in inspect(create_engine(url)).get_columns("copilot_sessions")}
    assert "owner_id" not in cols
    command.upgrade(ini, "head")


def test_alembic_0005_backfills_chart_index_columns(tmp_path):
    import json

    from sqlalchemy import text

    url = sqlite_url_for_path(tmp_path / "index.sqlite3")
    ini = alembic_config(url)
    command.upgrade(ini, "20261028_0004")
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO copilot_sessions (id, title, created_at, updated_at, payload)"
                " VALUES ('s', 't', 0, 0, '{}')"
            )
        )
        doc = json.dumps({"shapes": [{}, {}, {}], "analysis": {"bias": "x"}})
        conn.execute(
            text(
                "INSERT INTO chart_states (session_id, symbol, interval, revision, doc,"
                " updated_at) VALUES ('s', 'BTCUSDT', '4h', 1, :doc, 0)"
            ),
            {"doc": doc},
        )
    command.upgrade(ini, "head")
    with engine.connect() as conn:
        row = conn.execute(text("SELECT shape_count, has_analysis FROM chart_states")).one()
    assert (row[0], bool(row[1])) == (3, True)
    command.downgrade(ini, "20261028_0004")
    cols = {c["name"] for c in inspect(create_engine(url)).get_columns("chart_states")}
    assert "shape_count" not in cols


def test_alembic_0006_adds_feedback_owner_and_downgrades(tmp_path):
    url = sqlite_url_for_path(tmp_path / "fb-owner.sqlite3")
    ini = alembic_config(url)
    command.upgrade(ini, "head")
    cols = {c["name"] for c in inspect(create_engine(url)).get_columns("copilot_feedback")}
    assert "owner_id" in cols
    command.downgrade(ini, "20261028_0005")
    cols = {c["name"] for c in inspect(create_engine(url)).get_columns("copilot_feedback")}
    assert "owner_id" not in cols
    command.upgrade(ini, "head")
