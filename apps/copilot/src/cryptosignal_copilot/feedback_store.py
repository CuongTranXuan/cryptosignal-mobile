from __future__ import annotations

import json
import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from cryptosignal_copilot.db.engine import get_engine
from cryptosignal_copilot.db.migrate import run_db_migrations
from cryptosignal_copilot.db.models import CopilotFeedbackRow
from cryptosignal_copilot.schema import FeedbackAction


class FeedbackStore:
    def __init__(self, *, database_url: str | None = None, run_migrations: bool = False) -> None:
        self._engine = get_engine(database_url)
        self._session_factory = sessionmaker(bind=self._engine, expire_on_commit=False)
        if run_migrations:
            run_db_migrations(database_url, force=True)

    def _session(self) -> Session:
        return self._session_factory()

    def create(self, body: FeedbackAction, *, owner: str | None = None) -> str:
        row_id = str(uuid.uuid4())
        now = time.time()
        row = CopilotFeedbackRow(
            id=row_id,
            session_id=body.session_id,
            message_id=body.message_id,
            drawing_id=body.drawing_id,
            action=body.action,
            before_json=json.dumps(body.before) if body.before is not None else None,
            after_json=json.dumps(body.after) if body.after is not None else None,
            client_ts=body.client_ts,
            created_at=now,
            owner_id=owner,
        )
        with self._session() as session:
            session.add(row)
            session.commit()
        return row_id

    def export_rows(self, limit: int = 5000, *, owner: str | None = None) -> list[dict[str, Any]]:
        """`owner`'s rows; `owner=None` is the admin export (every row, legacy included)."""
        query = select(CopilotFeedbackRow)
        if owner is not None:
            query = query.where(CopilotFeedbackRow.owner_id == owner)
        with self._session() as session:
            rows = session.execute(
                query.order_by(CopilotFeedbackRow.created_at.desc()).limit(limit)
            ).scalars()
            out: list[dict[str, Any]] = []
            for row in rows:
                out.append(
                    {
                        "id": row.id,
                        "session_id": row.session_id,
                        "message_id": row.message_id,
                        "drawing_id": row.drawing_id,
                        "action": row.action,
                        "before": json.loads(row.before_json) if row.before_json else None,
                        "after": json.loads(row.after_json) if row.after_json else None,
                        "client_ts": row.client_ts,
                        "created_at": row.created_at,
                    }
                )
            return out


_default_feedback: FeedbackStore | None = None


def get_feedback_store() -> FeedbackStore:
    global _default_feedback
    if _default_feedback is None:
        _default_feedback = FeedbackStore()
    return _default_feedback
