"""add calendar episode indexes

Revision ID: 202608050001
Revises: 202607250001
Create Date: 2026-08-05 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "202608050001"
down_revision: str | None = "202607250001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_episode_anime_id_air_at", "episode", ["anime_id", "air_at"], unique=False)
    op.create_index(
        "ix_user_anime_metadata_episode_snapshot_snapshot_air_at",
        "user_anime_metadata_episode_snapshot",
        ["snapshot_id", "air_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_anime_metadata_episode_snapshot_snapshot_air_at",
        table_name="user_anime_metadata_episode_snapshot",
    )
    op.drop_index("ix_episode_anime_id_air_at", table_name="episode")
