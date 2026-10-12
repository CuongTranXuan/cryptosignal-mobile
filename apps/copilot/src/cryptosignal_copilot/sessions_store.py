from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from cryptosignal_copilot.config import load_sessions_db_path
from cryptosignal_copilot.schema import (
    CopilotSession,
    SessionChartContext,
    SessionMessage,
    SessionSummary,
)

MAX_SESSIONS = 50
MAX_MESSAGES_PER_SESSION = 200


class SessionNotFoundError(Exception):
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        super().__init__(session_id)


class SessionsStore:
    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or load_sessions_db_path()
        self._lock = threading.Lock()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS copilot_sessions (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL,
                        payload TEXT NOT NULL
                    )
                    """
                )
                conn.commit()

    def list_sessions(self) -> list[SessionSummary]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT id, title, created_at, updated_at, payload
                    FROM copilot_sessions
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    (MAX_SESSIONS,),
                ).fetchall()
        out: list[SessionSummary] = []
        for row in rows:
            session = CopilotSession.model_validate(json.loads(row["payload"]))
            out.append(
                SessionSummary(
                    id=session.id,
                    title=session.title,
                    created_at=session.created_at,
                    updated_at=session.updated_at,
                    model_id=session.model_id,
                    symbol=session.chart.symbol,
                    interval=session.chart.interval,
                    candle_count=session.chart.candle_count,
                    message_count=len(session.messages),
                )
            )
        return out

    def get_session(self, session_id: str) -> CopilotSession:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT payload FROM copilot_sessions WHERE id = ?",
                    (session_id,),
                ).fetchone()
        if row is None:
            raise SessionNotFoundError(session_id)
        return CopilotSession.model_validate(json.loads(row["payload"]))

    def create_session(
        self,
        *,
        title: str,
        model_id: str,
        chart: SessionChartContext,
        messages: list[SessionMessage] | None = None,
    ) -> CopilotSession:
        self._evict_if_needed()
        now = int(time.time())
        session = CopilotSession(
            id=str(uuid.uuid4()),
            title=title,
            created_at=now,
            updated_at=now,
            model_id=model_id,
            chart=chart,
            messages=(messages or [])[:MAX_MESSAGES_PER_SESSION],
        )
        self._upsert(session)
        return session

    def update_session(
        self,
        session_id: str,
        *,
        title: str | None = None,
        model_id: str | None = None,
        chart: SessionChartContext | None = None,
        messages: list[SessionMessage] | None = None,
    ) -> CopilotSession:
        record = self.get_session(session_id)
        if title is not None:
            record = record.model_copy(update={"title": title})
        if model_id is not None:
            record = record.model_copy(update={"model_id": model_id})
        if chart is not None:
            record = record.model_copy(update={"chart": chart})
        if messages is not None:
            record = record.model_copy(update={"messages": messages[:MAX_MESSAGES_PER_SESSION]})
        record = record.model_copy(update={"updated_at": int(time.time())})
        self._upsert(record)
        return record

    def delete_session(self, session_id: str) -> None:
        with self._lock:
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM copilot_sessions WHERE id = ?", (session_id,))
                conn.commit()
                if cur.rowcount == 0:
                    raise SessionNotFoundError(session_id)

    def _evict_if_needed(self) -> None:
        with self._lock:
            with self._connect() as conn:
                count = conn.execute("SELECT COUNT(*) FROM copilot_sessions").fetchone()[0]
                if count < MAX_SESSIONS:
                    return
                to_remove = count - MAX_SESSIONS + 1
                conn.execute(
                    """
                    DELETE FROM copilot_sessions
                    WHERE id IN (
                        SELECT id FROM copilot_sessions
                        ORDER BY updated_at ASC
                        LIMIT ?
                    )
                    """,
                    (to_remove,),
                )
                conn.commit()

    def _upsert(self, record: CopilotSession) -> None:
        payload = record.model_dump(mode="json", by_alias=True)
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO copilot_sessions (id, title, created_at, updated_at, payload)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        updated_at = excluded.updated_at,
                        payload = excluded.payload
                    """,
                    (
                        record.id,
                        record.title,
                        float(record.created_at),
                        float(record.updated_at),
                        json.dumps(payload),
                    ),
                )
                conn.commit()


_default_store: SessionsStore | None = None


def get_sessions_store() -> SessionsStore:
    global _default_store
    if _default_store is None:
        _default_store = SessionsStore()
    return _default_store


def reset_sessions_store_for_tests(db_path: Path) -> SessionsStore:
    global _default_store
    _default_store = SessionsStore(db_path=db_path)
    return _default_store
