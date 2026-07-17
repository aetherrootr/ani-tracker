"""add user account preferences

Revision ID: 202607180001
Revises: 202607160001
Create Date: 2026-07-18 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607180001"
down_revision: str | None = "202607160001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("time_zone", sa.String(length=64), server_default="UTC", nullable=False))
    op.add_column("users", sa.Column("time_zone_mode", sa.String(length=16), server_default="auto", nullable=False))
    # Existing accounts retain password login because their creation path cannot
    # be inferred reliably. OIDC reauthentication lets legacy OIDC-only users set one.
    op.add_column("users", sa.Column("password_login_enabled", sa.Boolean(), server_default="1", nullable=False))
    op.create_index(
        "ix_user_anime_metadata_episode_snapshot_watched_at",
        "user_anime_metadata_episode_snapshot",
        ["snapshot_id", "watched", "watched_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_anime_metadata_episode_snapshot_watched_at", table_name="user_anime_metadata_episode_snapshot")
    op.drop_column("users", "password_login_enabled")
    op.drop_column("users", "time_zone_mode")
    op.drop_column("users", "time_zone")
