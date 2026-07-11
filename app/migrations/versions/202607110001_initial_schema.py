"""initial schema

Revision ID: 202607110001
Revises:
Create Date: 2026-07-11 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202607110001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ANIME_TYPE_VALUES = ("tv", "movie", "ova", "ona", "special", "unknown")
EPISODE_STATUS_VALUES = ("aired", "upcoming", "delayed", "cancelled", "unknown")
USER_ANIME_STATUS_VALUES = ("watching", "completed", "plan_to_watch", "on_hold", "dropped")


def _enum(name: str, values: tuple[str, ...]) -> sa.Enum:
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=False)
    return sa.Enum(*values, name=name)


def _create_postgres_enums() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for name, values in (
        ("anime_type", ANIME_TYPE_VALUES),
        ("episode_status", EPISODE_STATUS_VALUES),
        ("user_anime_status", USER_ANIME_STATUS_VALUES),
    ):
        postgresql.ENUM(*values, name=name).create(bind, checkfirst=True)


def _drop_postgres_enums() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for name, values in (
        ("user_anime_status", USER_ANIME_STATUS_VALUES),
        ("episode_status", EPISODE_STATUS_VALUES),
        ("anime_type", ANIME_TYPE_VALUES),
    ):
        postgresql.ENUM(*values, name=name).drop(bind, checkfirst=True)


def _timestamps() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def upgrade() -> None:
    _create_postgres_enums()

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("language_preference", sa.String(length=10), nullable=False),
        sa.Column("week_start_day", sa.Integer(), server_default="0", nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )

    op.create_table(
        "anime_meta_info",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider_type", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("type", _enum("anime_type", ANIME_TYPE_VALUES), server_default="unknown", nullable=False),
        sa.Column("total_episodes", sa.Integer(), nullable=True),
        sa.Column("air_date", sa.Date(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_type", "external_id", name="uq_anime_meta_info_provider_type_external_id"),
    )

    op.create_table(
        "user_oidc_identities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("issuer", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("preferred_username", sa.String(length=255), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("issuer", "subject", name="uq_user_oidc_identities_issuer_subject"),
        sa.UniqueConstraint("user_id", "issuer", name="uq_user_oidc_identities_user_issuer"),
    )

    op.create_table(
        "anime_name",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("anime_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("language", sa.String(length=32), nullable=True),
        sa.Column("sort_key", sa.String(length=512), server_default="", nullable=False),
        sa.Column("initial_key", sa.String(length=16), server_default="#", nullable=False),
        sa.Column("search_key", sa.Text(), server_default="", nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("anime_id", "name", name="uq_anime_name_anime_id_name"),
    )
    op.create_index("ix_anime_name_initial_key", "anime_name", ["initial_key"])
    op.create_index("ix_anime_name_search_key", "anime_name", ["search_key"])
    op.create_index("ix_anime_name_sort_key", "anime_name", ["sort_key"])

    op.create_table(
        "anime_summary",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("anime_id", sa.Integer(), nullable=False),
        sa.Column("language", sa.String(length=32), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("anime_id", "language", name="uq_anime_summary_anime_language"),
    )

    op.create_table(
        "anime_poster",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("anime_id", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=64), server_default="", nullable=False),
        sa.Column("size_bytes", sa.Integer(), server_default="0", nullable=False),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("last_error", sa.String(length=1024), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("anime_id", "storage_path", name="uq_anime_poster_anime_id_storage_path"),
    )

    op.create_table(
        "anime_relation",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("anime_id", sa.Integer(), nullable=False),
        sa.Column("related_anime_id", sa.Integer(), nullable=True),
        sa.Column("poster_id", sa.Integer(), nullable=True),
        sa.Column("provider_type", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("relation_type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("season_number", sa.Integer(), nullable=True),
        sa.Column("air_date", sa.Date(), nullable=True),
        sa.Column("episode_count", sa.Integer(), nullable=True),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("poster_source_url", sa.String(length=2048), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["related_anime_id"], ["anime_meta_info.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["poster_id"], ["anime_poster.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "anime_id",
            "provider_type",
            "external_id",
            "relation_type",
            name="uq_anime_relation_source_provider_external_relation",
        ),
    )
    op.create_index("ix_anime_relation_provider_external", "anime_relation", ["provider_type", "external_id"])

    op.create_table(
        "episode",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("anime_id", sa.Integer(), nullable=False),
        sa.Column("episode_number", sa.Integer(), nullable=False),
        sa.Column("original_title", sa.String(length=255), nullable=True),
        sa.Column("air_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration", sa.String(length=16), nullable=True),
        sa.Column("status", _enum("episode_status", EPISODE_STATUS_VALUES), server_default="unknown", nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("anime_id", "episode_number", name="uq_episode_anime_id_episode_number"),
    )
    op.create_index("ix_episode_air_at", "episode", ["air_at"])
    op.create_index("ix_episode_anime_id_episode_number", "episode", ["anime_id", "episode_number"])

    op.create_table(
        "episode_name",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("episode_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("language", sa.String(length=32), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["episode_id"], ["episode.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("episode_id", "name", name="uq_episode_name_episode_id_name"),
    )

    op.create_table(
        "user_anime_progress",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("anime_id", sa.Integer(), nullable=False),
        sa.Column("status", _enum("user_anime_status", USER_ANIME_STATUS_VALUES), server_default="plan_to_watch", nullable=False),
        sa.Column("last_watched_episode_number", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_watched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("preferred_summary_id", sa.Integer(), nullable=True),
        sa.Column("preferred_poster_id", sa.Integer(), nullable=True),
        sa.Column("preferred_name_id", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["anime_id"], ["anime_meta_info.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["preferred_name_id"], ["anime_name.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["preferred_poster_id"], ["anime_poster.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["preferred_summary_id"], ["anime_summary.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "anime_id", name="uq_user_anime_progress_user_id_anime_id"),
    )
    op.create_index("ix_user_anime_progress_user_id_status", "user_anime_progress", ["user_id", "status"])

    op.create_table(
        "user_episode_progress",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("episode_id", sa.Integer(), nullable=False),
        sa.Column("watched", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("watched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("preferred_name_id", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["episode_id"], ["episode.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["preferred_name_id"], ["episode_name.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "episode_id", name="uq_user_episode_progress_user_id_episode_id"),
    )
    op.create_index("ix_user_episode_progress_user_id", "user_episode_progress", ["user_id"])
    op.create_index("ix_user_episode_progress_user_id_episode_id", "user_episode_progress", ["user_id", "episode_id"])
    op.create_index("ix_user_episode_progress_user_watched_at", "user_episode_progress", ["user_id", "watched", "watched_at"])


def downgrade() -> None:
    op.drop_index("ix_user_episode_progress_user_watched_at", table_name="user_episode_progress")
    op.drop_index("ix_user_episode_progress_user_id_episode_id", table_name="user_episode_progress")
    op.drop_index("ix_user_episode_progress_user_id", table_name="user_episode_progress")
    op.drop_table("user_episode_progress")
    op.drop_index("ix_user_anime_progress_user_id_status", table_name="user_anime_progress")
    op.drop_table("user_anime_progress")
    op.drop_table("episode_name")
    op.drop_index("ix_episode_anime_id_episode_number", table_name="episode")
    op.drop_index("ix_episode_air_at", table_name="episode")
    op.drop_table("episode")
    op.drop_index("ix_anime_relation_provider_external", table_name="anime_relation")
    op.drop_table("anime_relation")
    op.drop_table("anime_poster")
    op.drop_table("anime_summary")
    op.drop_index("ix_anime_name_sort_key", table_name="anime_name")
    op.drop_index("ix_anime_name_search_key", table_name="anime_name")
    op.drop_index("ix_anime_name_initial_key", table_name="anime_name")
    op.drop_table("anime_name")
    op.drop_table("user_oidc_identities")
    op.drop_table("anime_meta_info")
    op.drop_table("users")
    _drop_postgres_enums()
