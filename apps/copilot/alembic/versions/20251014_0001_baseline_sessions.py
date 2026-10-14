"""Baseline copilot_sessions (legacy SQLite compatible).

Revision ID: 20251014_0001
Revises:
Create Date: 2025-10-14

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "20251014_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "copilot_sessions"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if _TABLE not in inspector.get_table_names():
        op.create_table(
            _TABLE,
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("created_at", sa.Float(), nullable=False),
            sa.Column("updated_at", sa.Float(), nullable=False),
            sa.Column("payload", sa.Text(), nullable=False),
            sa.Column("reasoning_effort", sa.String(), nullable=True),
        )
        return

    columns = {col["name"] for col in inspector.get_columns(_TABLE)}
    if "reasoning_effort" not in columns:
        with op.batch_alter_table(_TABLE) as batch_op:
            batch_op.add_column(sa.Column("reasoning_effort", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if _TABLE not in inspector.get_table_names():
        return
    op.drop_table(_TABLE)
