"""add user import provider preference

Revision ID: 202607120001
Revises: 202607110001
Create Date: 2026-07-12 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607120001"
down_revision: str | None = "202607110001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "import_provider_preference",
            sa.String(length=64),
            server_default="bangumi",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "import_provider_preference")
