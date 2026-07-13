"""add season zero preferences

Revision ID: 202607140001
Revises: 202607120002
Create Date: 2026-07-14 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607140001"
down_revision: str | None = "202607120002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("include_unwatched_season_zero_in_tracking", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("include_unwatched_season_zero_in_statistics", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "include_unwatched_season_zero_in_statistics")
    op.drop_column("users", "include_unwatched_season_zero_in_tracking")
