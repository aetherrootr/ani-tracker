from __future__ import annotations

import enum
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
    and_,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from app.models.anime import AnimeMetaInfo, Episode, EpisodeStatus
from app.models.base import TimestampedBase, enum_values
from app.models.user import User
from app.models.validater import validate_pagination

if TYPE_CHECKING:
    from app.models.anime import AnimeName, AnimePoster, AnimeSummary, EpisodeName


class UserAnimeStatus(enum.Enum):
    WATCHING = "watching"
    COMPLETED = "completed"
    PLAN_TO_WATCH = "plan_to_watch"
    ON_HOLD = "on_hold"
    DROPPED = "dropped"


class UserEpisodeProgress(TimestampedBase):
    __tablename__ = "user_episode_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "episode_id", name="uq_user_episode_progress_user_id_episode_id"),
        Index("ix_user_episode_progress_user_id", "user_id"),
        Index("ix_user_episode_progress_user_id_episode_id", "user_id", "episode_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    episode_id: Mapped[int] = mapped_column(ForeignKey("episode.id", ondelete="CASCADE"), nullable=False)
    watched: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    watched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    preferred_name_id: Mapped[int | None] = mapped_column(
        ForeignKey("episode_name.id", ondelete="SET NULL"),
    )

    user: Mapped[User] = relationship(back_populates="episode_progresses")
    episode: Mapped[Episode] = relationship(back_populates="user_progresses")
    preferred_name: Mapped[EpisodeName | None] = relationship()


class UserAnimeProgress(TimestampedBase):
    __tablename__ = "user_anime_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "anime_id", name="uq_user_anime_progress_user_id_anime_id"),
        Index("ix_user_anime_progress_user_id_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    anime_id: Mapped[int] = mapped_column(
        ForeignKey("anime_meta_info.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[UserAnimeStatus] = mapped_column(
        Enum(
            UserAnimeStatus,
            name="user_anime_status",
            values_callable=enum_values,
        ),
        default=UserAnimeStatus.PLAN_TO_WATCH,
        server_default=UserAnimeStatus.PLAN_TO_WATCH.value,
        nullable=False,
    )
    last_watched_episode_number: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    last_watched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    preferred_summary_id: Mapped[int | None] = mapped_column(
        ForeignKey("anime_summary.id", ondelete="SET NULL"),
    )
    preferred_poster_id: Mapped[int | None] = mapped_column(
        ForeignKey("anime_poster.id", ondelete="SET NULL"),
    )
    preferred_name_id: Mapped[int | None] = mapped_column(
        ForeignKey("anime_name.id", ondelete="SET NULL"),
    )

    user: Mapped[User] = relationship(back_populates="anime_progresses")
    anime: Mapped[AnimeMetaInfo] = relationship(back_populates="user_progresses")
    preferred_summary: Mapped[AnimeSummary | None] = relationship()
    preferred_poster: Mapped[AnimePoster | None] = relationship()
    preferred_name: Mapped[AnimeName | None] = relationship()


def get_user_watchlist(
    session: Session,
    user_id: int,
    *,
    limit: int = 20,
    offset: int = 0,
) -> list[dict[str, Any]]:
    limit, offset = validate_pagination(limit, offset)
    watched_count = func.count(UserEpisodeProgress.id).filter(UserEpisodeProgress.watched.is_(True))
    aired_count = func.count(Episode.id).filter(Episode.status == EpisodeStatus.AIRED)

    stmt = (
        select(
            AnimeMetaInfo.id.label("anime_id"),
            AnimeMetaInfo.original_name,
            AnimeMetaInfo.total_episodes,
            UserAnimeProgress.status,
            aired_count.label("aired_episodes"),
            watched_count.label("watched_episodes"),
        )
        .join(UserAnimeProgress.anime)
        .outerjoin(Episode, Episode.anime_id == AnimeMetaInfo.id)
        .outerjoin(
            UserEpisodeProgress,
            and_(
                UserEpisodeProgress.episode_id == Episode.id,
                UserEpisodeProgress.user_id == user_id,
            ),
        )
        .where(UserAnimeProgress.user_id == user_id)
        .group_by(
            AnimeMetaInfo.id,
            AnimeMetaInfo.original_name,
            AnimeMetaInfo.total_episodes,
            UserAnimeProgress.status,
        )
        .order_by(AnimeMetaInfo.original_name)
        .limit(limit)
        .offset(offset)
    )

    rows = session.execute(stmt).all()
    return [
        {
            "anime_id": row.anime_id,
            "original_name": row.original_name,
            "total_episodes": row.total_episodes,
            "aired_episodes": row.aired_episodes,
            "watched_episodes": row.watched_episodes,
            "unwatched_episodes": max(row.aired_episodes - row.watched_episodes, 0),
            "status": row.status,
        }
        for row in rows
    ]


def get_anime_episodes_with_watch_state(
    session: Session,
    *,
    anime_id: int,
    user_id: int,
    limit: int = 20,
    offset: int = 0,
) -> list[dict[str, Any]]:
    limit, offset = validate_pagination(limit, offset)
    stmt = (
        select(
            Episode.id.label("episode_id"),
            Episode.episode_number,
            Episode.original_title,
            Episode.air_at,
            Episode.duration,
            Episode.status,
            func.coalesce(UserEpisodeProgress.watched, False).label("watched"),
            UserEpisodeProgress.watched_at,
            UserEpisodeProgress.preferred_name_id,
        )
        .outerjoin(
            UserEpisodeProgress,
            and_(
                UserEpisodeProgress.episode_id == Episode.id,
                UserEpisodeProgress.user_id == user_id,
            ),
        )
        .where(Episode.anime_id == anime_id)
        .order_by(Episode.episode_number)
        .limit(limit)
        .offset(offset)
    )

    return [dict(row) for row in session.execute(stmt).mappings().all()]


def mark_episode_watched(
    session: Session,
    *,
    user_id: int,
    episode_id: int,
    watched_at: datetime | None = None,
) -> None:
    watched_at = watched_at or datetime.now(UTC)
    episode = session.get(Episode, episode_id)
    if episode is None:
        msg = f"Episode {episode_id} does not exist"
        raise ValueError(msg)

    progress_stmt = insert(UserEpisodeProgress).values(
        user_id=user_id,
        episode_id=episode_id,
        watched=True,
        watched_at=watched_at,
    )
    progress_stmt = progress_stmt.on_conflict_do_update(
        index_elements=[UserEpisodeProgress.user_id, UserEpisodeProgress.episode_id],
        set_={
            "watched": True,
            "watched_at": watched_at,
            "updated_at": func.now(),
        },
    )
    session.execute(progress_stmt)

    anime_stmt = insert(UserAnimeProgress).values(
        user_id=user_id,
        anime_id=episode.anime_id,
        status=UserAnimeStatus.WATCHING,
        last_watched_episode_number=episode.episode_number,
        last_watched_at=watched_at,
    )
    anime_stmt = anime_stmt.on_conflict_do_update(
        index_elements=[UserAnimeProgress.user_id, UserAnimeProgress.anime_id],
        set_={
            "last_watched_episode_number": func.greatest(
                UserAnimeProgress.last_watched_episode_number,
                episode.episode_number,
            ),
            "last_watched_at": watched_at,
            "updated_at": func.now(),
        },
    )
    session.execute(anime_stmt)


def unmark_episode_watched(
    session: Session,
    *,
    user_id: int,
    episode_id: int,
) -> None:
    progress = session.scalar(
        select(UserEpisodeProgress).where(
            UserEpisodeProgress.user_id == user_id,
            UserEpisodeProgress.episode_id == episode_id,
        ),
    )
    if progress is None:
        return

    # Keeping the row preserves audit/history intent; deleting the row is simpler
    # if the application treats absence as the only representation of unwatched.
    progress.watched = False
    progress.watched_at = None
