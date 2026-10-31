"""Add chart_states.shape_count / has_analysis (index metadata, no doc parsing).

Revision ID: 20261028_0005
Revises: 20261028_0004
Create Date: 2026-10-28

"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "20261028_0005"
down_revision: str | None = "20261028_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "chart_states"


def _columns() -> set[str]:
    return {col["name"] for col in inspect(op.get_bind()).get_columns(_TABLE)}


def upgrade() -> None:
    if "shape_count" in _columns():
        return
    with op.batch_alter_table(_TABLE) as batch_op:
        batch_op.add_column(
            sa.Column("shape_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("has_analysis", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    bind = op.get_bind()
    table = sa.table(
        _TABLE,
        sa.column("id", sa.Integer()),
        sa.column("doc", sa.Text()),
        sa.column("shape_count", sa.Integer()),
        sa.column("has_analysis", sa.Boolean()),
    )
    for row_id, doc in bind.execute(sa.select(table.c.id, table.c.doc)).all():
        try:
            body = json.loads(doc)
        except ValueError:
            continue
        bind.execute(
            table.update()
            .where(table.c.id == row_id)
            .values(
                shape_count=len(body.get("shapes") or []),
                has_analysis=body.get("analysis") is not None,
            )
        )


def downgrade() -> None:
    if "shape_count" not in _columns():
        return
    with op.batch_alter_table(_TABLE) as batch_op:
        batch_op.drop_column("has_analysis")
        batch_op.drop_column("shape_count")
