"""add user anime relation override

Revision ID: 202607120002
Revises: 202607120001
Create Date: 2026-07-12 00:02:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607120002"
down_revision: str | None = "202607120001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_anime_relation_override",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("anime_relation_id", sa.Integer(), nullable=False),
        sa.Column("related_anime_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["anime_relation_id"], ["anime_relation.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["related_anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "anime_relation_id", name="uq_user_anime_relation_override_user_relation"),
    )
    op.create_index("ix_user_anime_relation_override_user_id", "user_anime_relation_override", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_anime_relation_override_user_id", table_name="user_anime_relation_override")
    op.drop_table("user_anime_relation_override")
