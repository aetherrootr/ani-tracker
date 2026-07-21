"""add anime relation titles

Revision ID: 202607220001
Revises: 202607180002
Create Date: 2026-07-22 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607220001"
down_revision: str | None = "202607180002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "anime_relation_title",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("anime_relation_id", sa.Integer(), nullable=False),
        sa.Column("language", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["anime_relation_id"], ["anime_relation.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("anime_relation_id", "language", name="uq_anime_relation_title_relation_language"),
    )
    op.execute(
        "INSERT INTO anime_relation_title (anime_relation_id, language, title) "
        "SELECT id, 'und', title FROM anime_relation",
    )


def downgrade() -> None:
    op.drop_table("anime_relation_title")
