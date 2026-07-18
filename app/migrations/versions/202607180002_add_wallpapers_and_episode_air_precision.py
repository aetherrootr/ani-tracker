"""add wallpapers and episode air precision

Revision ID: 202607180002
Revises: 202607180001
Create Date: 2026-07-18 00:02:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607180002"
down_revision: str | None = "202607180001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("desktop_wallpaper_mode", sa.String(length=16), server_default="fixed", nullable=False))
    op.add_column("users", sa.Column("mobile_wallpaper_mode", sa.String(length=16), server_default="fixed", nullable=False))
    op.add_column("users", sa.Column("share_wallpapers_on_login", sa.Boolean(), server_default="0", nullable=False))
    op.add_column("users", sa.Column("wallpaper_glass_style", sa.String(length=16), server_default="regular", nullable=False))
    op.add_column("users", sa.Column("wallpaper_glass_intensity", sa.Integer(), server_default="50", nullable=False))
    op.create_table(
        "user_wallpapers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("variant", sa.String(length=16), nullable=False),
        sa.Column("storage_path", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("selected", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "variant", "content_hash", name="uq_user_wallpapers_user_variant_hash"),
    )
    op.add_column("episode", sa.Column("air_at_has_time", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column(
        "user_anime_metadata_episode_snapshot",
        sa.Column("air_at_has_time", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("user_anime_metadata_episode_snapshot", "air_at_has_time")
    op.drop_column("episode", "air_at_has_time")
    op.drop_table("user_wallpapers")
    op.drop_column("users", "wallpaper_glass_intensity")
    op.drop_column("users", "wallpaper_glass_style")
    op.drop_column("users", "share_wallpapers_on_login")
    op.drop_column("users", "mobile_wallpaper_mode")
    op.drop_column("users", "desktop_wallpaper_mode")
