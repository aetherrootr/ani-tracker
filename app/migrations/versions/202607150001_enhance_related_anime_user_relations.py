"""enhance related anime user relations

Revision ID: 202607150001
Revises: 202607140001
Create Date: 2026-07-15 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607150001"
down_revision: str | None = "202607140001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_anime_relation_override", sa.Column("allow_provider_import", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("anime_relation", sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("anime_relation", sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "user_manual_anime_relation",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("anime_id_low", sa.Integer(), nullable=False),
        sa.Column("anime_id_high", sa.Integer(), nullable=False),
        sa.Column("relation_type", sa.String(length=64), server_default="same_series_manual", nullable=False),
        sa.Column("note", sa.String(length=1024), nullable=True),
        sa.Column("created_from_anime_relation_id", sa.Integer(), nullable=True),
        sa.Column("created_from_provider", sa.String(length=64), nullable=True),
        sa.Column("created_from_external_id", sa.String(length=255), nullable=True),
        sa.Column("snapshot_title", sa.String(length=255), nullable=True),
        sa.Column("snapshot_air_date", sa.Date(), nullable=True),
        sa.Column("snapshot_episode_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["anime_id_high"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["anime_id_low"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_from_anime_relation_id"], ["anime_relation.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "anime_id_low", "anime_id_high", "relation_type", name="uq_user_manual_anime_relation_pair"),
    )
    op.create_index("ix_user_manual_anime_relation_user_high", "user_manual_anime_relation", ["user_id", "anime_id_high"])
    op.create_index("ix_user_manual_anime_relation_user_low", "user_manual_anime_relation", ["user_id", "anime_id_low"])
    op.create_table(
        "user_anime_relation_deletion_prompt",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("anime_id", sa.Integer(), nullable=False),
        sa.Column("related_anime_id", sa.Integer(), nullable=True),
        sa.Column("anime_relation_id", sa.Integer(), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("relation_type", sa.String(length=64), nullable=False),
        sa.Column("season_number", sa.Integer(), nullable=True),
        sa.Column("air_date", sa.Date(), nullable=True),
        sa.Column("episode_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["anime_relation_id"], ["anime_relation.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["related_anime_id"], ["anime_meta_info.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "anime_relation_id", name="uq_user_anime_relation_deletion_prompt_user_relation"),
    )
    op.create_index("ix_user_anime_relation_deletion_prompt_user_anime", "user_anime_relation_deletion_prompt", ["user_id", "anime_id"])


def downgrade() -> None:
    op.drop_index("ix_user_anime_relation_deletion_prompt_user_anime", table_name="user_anime_relation_deletion_prompt")
    op.drop_table("user_anime_relation_deletion_prompt")
    op.drop_index("ix_user_manual_anime_relation_user_low", table_name="user_manual_anime_relation")
    op.drop_index("ix_user_manual_anime_relation_user_high", table_name="user_manual_anime_relation")
    op.drop_table("user_manual_anime_relation")
    op.drop_column("anime_relation", "removed_at")
    op.drop_column("anime_relation", "is_active")
    op.drop_column("user_anime_relation_override", "allow_provider_import")
