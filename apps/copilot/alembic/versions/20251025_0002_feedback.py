"""Add copilot_feedback table and sessions.intent_json column.

Revision ID: 20251025_0002
Revises: 20251014_0001
Create Date: 2025-10-25

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "20251025_0002"
down_revision: Union[str, None] = "20251014_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FEEDBACK = "copilot_feedback"
_SESSIONS = "copilot_sessions"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if _FEEDBACK not in inspector.get_table_names():
        op.create_table(
            _FEEDBACK,
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("session_id", sa.String(), nullable=False),
            sa.Column("message_id", sa.String(), nullable=True),
            sa.Column("drawing_id", sa.String(), nullable=False),
            sa.Column("action", sa.String(), nullable=False),
            sa.Column("before_json", sa.Text(), nullable=True),
            sa.Column("after_json", sa.Text(), nullable=True),
            sa.Column("client_ts", sa.Float(), nullable=True),
            sa.Column("created_at", sa.Float(), nullable=False),
        )
        op.create_index("ix_copilot_feedback_session_id", _FEEDBACK, ["session_id"])
        op.create_index("ix_copilot_feedback_drawing_id", _FEEDBACK, ["drawing_id"])

    if _SESSIONS in inspector.get_table_names():
        cols = {col["name"] for col in inspector.get_columns(_SESSIONS)}
        if "intent_json" not in cols:
            with op.batch_alter_table(_SESSIONS) as batch_op:
                batch_op.add_column(sa.Column("intent_json", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if _FEEDBACK in inspector.get_table_names():
        op.drop_table(_FEEDBACK)
    if _SESSIONS in inspector.get_table_names():
        cols = {col["name"] for col in inspector.get_columns(_SESSIONS)}
        if "intent_json" in cols:
            with op.batch_alter_table(_SESSIONS) as batch_op:
                batch_op.drop_column("intent_json")
