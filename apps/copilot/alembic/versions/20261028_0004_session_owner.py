"""Add copilot_sessions.owner_id (device ownership, src/cryptosignal_copilot/device.py).

Existing rows stay NULL (legacy): the first device that opens one adopts it.

Revision ID: 20261028_0004
Revises: 20261026_0003
Create Date: 2026-10-28

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "20261028_0004"
down_revision: str | None = "20261026_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SESSIONS = "copilot_sessions"
_INDEX = "ix_copilot_sessions_owner_id"


def _columns() -> set[str]:
    return {col["name"] for col in inspect(op.get_bind()).get_columns(_SESSIONS)}


def upgrade() -> None:
    if "owner_id" in _columns():
        return
    with op.batch_alter_table(_SESSIONS) as batch_op:
        batch_op.add_column(sa.Column("owner_id", sa.String(), nullable=True))
        batch_op.create_index(_INDEX, ["owner_id"])


def downgrade() -> None:
    if "owner_id" not in _columns():
        return
    with op.batch_alter_table(_SESSIONS) as batch_op:
        batch_op.drop_index(_INDEX)
        batch_op.drop_column("owner_id")
