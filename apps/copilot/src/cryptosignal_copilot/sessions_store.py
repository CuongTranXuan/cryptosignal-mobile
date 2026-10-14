from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from cryptosignal_copilot.config import sqlite_url_for_path
from cryptosignal_copilot.db.engine import get_engine, reset_engine_for_tests
from cryptosignal_copilot.db.migrate import run_db_migrations
from cryptosignal_copilot.db.models import CopilotSessionRow
from cryptosignal_copilot.schema import (
    CopilotSession,
    SessionChartContext,
    SessionMessage,
    SessionSummary,
    normalize_session_reasoning_effort,
)


def _coerce_chart(value: object) -> SessionChartContext:
    if isinstance(value, SessionChartContext):
        return value
    if isinstance(value, dict):
        return SessionChartContext.model_validate(value)
    raise TypeError(f"chart must be SessionChartContext or dict, got {type(value)!r}")


MAX_SESSIONS = 50
MAX_MESSAGES_PER_SESSION = 200


class SessionNotFoundError(Exception):
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        super().__init__(session_id)


class SessionsStore:
    def __init__(
        self,
        *,
        database_url: str | None = None,
        db_path: Path | None = None,
        run_migrations: bool = False,
    ) -> None:
        url = database_url
        if url is None and db_path is not None:
            url = sqlite_url_for_path(db_path)
        self._database_url = url
        self._engine = get_engine(url)
        self._session_factory = sessionmaker(bind=self._engine, expire_on_commit=False)
        self._lock = threading.Lock()
        if run_migrations:
            run_db_migrations(url, force=True)

    def _session(self) -> Session:
        return self._session_factory()

    def list_sessions(self) -> list[SessionSummary]:
        with self._lock:
            with self._session() as session:
                rows = session.execute(
                    select(CopilotSessionRow)
                    .order_by(CopilotSessionRow.updated_at.desc())
                    .limit(MAX_SESSIONS)
                ).scalars()
                payloads = [row.payload for row in rows]
        out: list[SessionSummary] = []
        for payload in payloads:
            record = CopilotSession.model_validate(json.loads(payload))
            out.append(
                SessionSummary(
                    id=record.id,
                    title=record.title,
                    created_at=record.created_at,
                    updated_at=record.updated_at,
                    model_id=record.model_id,
                    reasoning_effort=record.reasoning_effort,
                    symbol=record.chart.symbol,
                    interval=record.chart.interval,
                    candle_count=record.chart.candle_count,
                    message_count=len(record.messages),
                )
            )
        return out

    def get_session(self, session_id: str) -> CopilotSession:
        with self._lock:
            with self._session() as session:
                row = session.get(CopilotSessionRow, session_id)
        if row is None:
            raise SessionNotFoundError(session_id)
        return CopilotSession.model_validate(json.loads(row.payload))

    def create_session(
        self,
        *,
        title: str,
        model_id: str,
        chart: SessionChartContext,
        messages: list[SessionMessage] | None = None,
        reasoning_effort: str | None = None,
    ) -> CopilotSession:
        self._evict_if_needed()
        now = int(time.time())
        record = CopilotSession(
            id=str(uuid.uuid4()),
            title=title,
            created_at=now,
            updated_at=now,
            model_id=model_id,
            reasoning_effort=normalize_session_reasoning_effort(reasoning_effort),
            chart=chart,
            messages=(messages or [])[:MAX_MESSAGES_PER_SESSION],
        )
        self._upsert(record)
        return record

    def update_session(self, session_id: str, **updates: Any) -> CopilotSession:
        record = self.get_session(session_id)
        allowed = {"title", "model_id", "chart", "messages", "reasoning_effort"}
        for key, value in updates.items():
            if key not in allowed:
                continue
            if key == "reasoning_effort":
                value = normalize_session_reasoning_effort(value)
            if key == "chart" and value is not None:
                value = _coerce_chart(value)
            if key == "messages" and value is not None:
                value = value[:MAX_MESSAGES_PER_SESSION]
            record = record.model_copy(update={key: value})
        record = record.model_copy(update={"updated_at": int(time.time())})
        self._upsert(record)
        return record

    def delete_session(self, session_id: str) -> None:
        with self._lock:
            with self._session() as session:
                row = session.get(CopilotSessionRow, session_id)
                if row is None:
                    raise SessionNotFoundError(session_id)
                session.delete(row)
                session.commit()

    def _evict_if_needed(self) -> None:
        with self._lock:
            with self._session() as session:
                count = session.scalar(select(func.count()).select_from(CopilotSessionRow)) or 0
                if count < MAX_SESSIONS:
                    return
                to_remove = count - MAX_SESSIONS + 1
                oldest = session.execute(
                    select(CopilotSessionRow.id)
                    .order_by(CopilotSessionRow.updated_at.asc())
                    .limit(to_remove)
                ).scalars()
                ids = list(oldest)
                if ids:
                    session.execute(delete(CopilotSessionRow).where(CopilotSessionRow.id.in_(ids)))
                session.commit()

    def _upsert(self, record: CopilotSession) -> None:
        payload = record.model_dump(mode="json", by_alias=True)
        row = CopilotSessionRow(
            id=record.id,
            title=record.title,
            created_at=float(record.created_at),
            updated_at=float(record.updated_at),
            payload=json.dumps(payload),
            reasoning_effort=record.reasoning_effort,
        )
        with self._lock:
            with self._session() as session:
                session.merge(row)
                session.commit()

    def has_reasoning_effort_column(self) -> bool:
        """Test helper: verify denormalized column exists (post-migration)."""
        from sqlalchemy import inspect as sa_inspect

        inspector = sa_inspect(self._engine)
        cols = {col["name"] for col in inspector.get_columns("copilot_sessions")}
        return "reasoning_effort" in cols


_default_store: SessionsStore | None = None


def get_sessions_store() -> SessionsStore:
    global _default_store
    if _default_store is None:
        _default_store = SessionsStore()
    return _default_store


def reset_sessions_store_for_tests(db_path: Path) -> SessionsStore:
    global _default_store
    reset_engine_for_tests()
    _default_store = SessionsStore(db_path=db_path, run_migrations=True)
    return _default_store
