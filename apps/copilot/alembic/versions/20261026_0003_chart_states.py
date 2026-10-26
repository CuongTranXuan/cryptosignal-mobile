"""Add chart_states (per-session chart history, docs/CHART_HISTORY_SPEC.md).

Revision ID: 20261026_0003
Revises: 20251025_0002
Create Date: 2026-10-26

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "20261026_0003"
down_revision: str | None = "20251025_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "chart_states"


def upgrade() -> None:
    if _TABLE in inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "session_id",
            sa.String(),
            sa.ForeignKey("copilot_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("interval", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("doc", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Float(), nullable=False),
        sa.Column("analyzed_at", sa.Float(), nullable=True),
        sa.UniqueConstraint("session_id", "symbol", "interval", name="uq_chart_states_key"),
    )
    op.create_index("ix_chart_states_session_id", _TABLE, ["session_id"])


def downgrade() -> None:
    if _TABLE not in inspect(op.get_bind()).get_table_names():
        return
    op.drop_index("ix_chart_states_session_id", table_name=_TABLE)
    op.drop_table(_TABLE)
