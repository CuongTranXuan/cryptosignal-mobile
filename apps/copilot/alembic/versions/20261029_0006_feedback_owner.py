"""Add copilot_feedback.owner_id (device that sent the feedback).

Existing rows stay NULL (legacy): only the admin export returns them.

Revision ID: 20261029_0006
Revises: 20261028_0005
Create Date: 2026-10-29

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "20261029_0006"
down_revision: str | None = "20261028_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "copilot_feedback"
_INDEX = "ix_copilot_feedback_owner_id"


def _columns() -> set[str]:
    return {col["name"] for col in inspect(op.get_bind()).get_columns(_TABLE)}


def upgrade() -> None:
    if "owner_id" in _columns():
        return
    with op.batch_alter_table(_TABLE) as batch_op:
        batch_op.add_column(sa.Column("owner_id", sa.String(), nullable=True))
        batch_op.create_index(_INDEX, ["owner_id"])


def downgrade() -> None:
    if "owner_id" not in _columns():
        return
    with op.batch_alter_table(_TABLE) as batch_op:
        batch_op.drop_index(_INDEX)
        batch_op.drop_column("owner_id")
