from __future__ import annotations

import sqlite3

_SESSIONS_TABLE = "copilot_sessions"


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {str(row[1]) for row in rows}


def apply_sessions_migrations(conn: sqlite3.Connection) -> None:
    """Idempotent SQLite migrations for copilot_sessions (denormalized columns)."""
    cols = _column_names(conn, _SESSIONS_TABLE)
    if "reasoning_effort" not in cols:
        conn.execute(f"ALTER TABLE {_SESSIONS_TABLE} ADD COLUMN reasoning_effort TEXT")
