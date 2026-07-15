"""add local metadata snapshots

Revision ID: 202607160001
Revises: 202607150001
Create Date: 2026-07-16 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607160001"
down_revision: str | None = "202607150001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_anime_metadata_snapshot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("anime_id", sa.Integer(), nullable=False),
        sa.Column("source_anime_id", sa.Integer(), nullable=True),
        sa.Column("source_provider", sa.String(length=64), nullable=False),
        sa.Column("source_external_id", sa.String(length=255), nullable=False),
        sa.Column("source_title", sa.String(length=255), nullable=False),
        sa.Column("episode_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_anime_id"], ["anime_meta_info.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "anime_id", name="uq_user_anime_metadata_snapshot_user_anime"),
    )
    op.create_index("ix_user_anime_metadata_snapshot_user_anime", "user_anime_metadata_snapshot", ["user_id", "anime_id"])
    op.create_table(
        "user_anime_metadata_episode_snapshot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_id", sa.Integer(), nullable=False),
        sa.Column("episode_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("air_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration", sa.String(length=16), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="unknown", nullable=False),
        sa.Column("watched", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("watched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("names", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["snapshot_id"], ["user_anime_metadata_snapshot.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("snapshot_id", "episode_number", name="uq_user_anime_metadata_episode_snapshot_number"),
    )
    op.create_index("ix_user_anime_metadata_episode_snapshot_snapshot_number", "user_anime_metadata_episode_snapshot", ["snapshot_id", "episode_number"])
    op.add_column("user_anime_progress", sa.Column("metadata_source", sa.String(length=32), server_default="upstream", nullable=False))
    op.add_column("user_anime_progress", sa.Column("metadata_snapshot_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_anime_progress", "metadata_snapshot_id")
    op.drop_column("user_anime_progress", "metadata_source")
    op.drop_index("ix_user_anime_metadata_episode_snapshot_snapshot_number", table_name="user_anime_metadata_episode_snapshot")
    op.drop_table("user_anime_metadata_episode_snapshot")
    op.drop_index("ix_user_anime_metadata_snapshot_user_anime", table_name="user_anime_metadata_snapshot")
    op.drop_table("user_anime_metadata_snapshot")
