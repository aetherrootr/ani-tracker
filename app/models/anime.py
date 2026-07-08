from __future__ import annotations

import enum
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.import_provider.types import ProviderType
from app.models.base import TimestampedBase, enum_values
from app.models.validater import validate_duration, validate_provider_type
from app.services.name_keys import build_name_keys

if TYPE_CHECKING:
    from app.models.progress import UserAnimeProgress, UserEpisodeProgress


class AnimeType(enum.Enum):
    TV = "tv"   # television animation
    MOVIE = "movie"
    OVA = "ova"  # original video animation
    ONA = "ona"  # original net animation
    SPECIAL = "special"
    UNKNOWN = "unknown"


class EpisodeStatus(enum.Enum):
    AIRED = "aired"
    UPCOMING = "upcoming"
    DELAYED = "delayed"
    CANCELLED = "cancelled"
    UNKNOWN = "unknown"


class AnimeMetaInfo(TimestampedBase):
    __tablename__ = "anime_meta_info"
    __table_args__ = (
        UniqueConstraint(
            "provider_type",
            "external_id",
            name="uq_anime_meta_info_provider_type_external_id",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_type: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048))
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[AnimeType] = mapped_column(
        Enum(
            AnimeType,
            name="anime_type",
            values_callable=enum_values,
        ),
        default=AnimeType.UNKNOWN,
        server_default=AnimeType.UNKNOWN.value,
        nullable=False,
    )
    total_episodes: Mapped[int | None] = mapped_column(Integer)
    air_date: Mapped[date | None] = mapped_column(Date)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    names: Mapped[list[AnimeName]] = relationship(
        back_populates="anime",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    episodes: Mapped[list[Episode]] = relationship(
        back_populates="anime",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    summaries: Mapped[list[AnimeSummary]] = relationship(
        back_populates="anime",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    posters: Mapped[list[AnimePoster]] = relationship(
        back_populates="anime",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    user_progresses: Mapped[list[UserAnimeProgress]] = relationship(
        back_populates="anime",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    @validates("provider_type")
    def _validate_provider_type(self, _key: str, provider_type: ProviderType | str) -> str:
        return validate_provider_type(provider_type)


class AnimeName(TimestampedBase):
    __tablename__ = "anime_name"
    __table_args__ = (
        UniqueConstraint("anime_id", "name", name="uq_anime_name_anime_id_name"),
        Index("ix_anime_name_sort_key", "sort_key"),
        Index("ix_anime_name_initial_key", "initial_key"),
        Index("ix_anime_name_search_key", "search_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    anime_id: Mapped[int] = mapped_column(
        ForeignKey("anime_meta_info.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    language: Mapped[str | None] = mapped_column(String(32))
    sort_key: Mapped[str] = mapped_column(String(512), default="", server_default="", nullable=False)
    initial_key: Mapped[str] = mapped_column(String(16), default="#", server_default="#", nullable=False)
    search_key: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)

    anime: Mapped[AnimeMetaInfo] = relationship(back_populates="names")

    @validates("name")
    def _validate_name(self, _key: str, name: str) -> str:
        normalized_name = name.strip()
        self.sort_key, self.initial_key, self.search_key = build_name_keys(normalized_name)
        return normalized_name


class AnimeSummary(TimestampedBase):
    __tablename__ = "anime_summary"
    __table_args__ = (
        UniqueConstraint(
            "anime_id",
            "language",
            name="uq_anime_summary_anime_language",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    anime_id: Mapped[int] = mapped_column(
        ForeignKey("anime_meta_info.id", ondelete="CASCADE"),
        nullable=False,
    )
    language: Mapped[str] = mapped_column(String(32), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)

    anime: Mapped[AnimeMetaInfo] = relationship(back_populates="summaries")


class AnimePoster(TimestampedBase):
    __tablename__ = "anime_poster"
    __table_args__ = (UniqueConstraint("anime_id", "storage_path", name="uq_anime_poster_anime_id_storage_path"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    anime_id: Mapped[int] = mapped_column(
        ForeignKey("anime_meta_info.id", ondelete="CASCADE"),
        nullable=False,
    )
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), default="", server_default="", nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2048))
    status: Mapped[str] = mapped_column(String(32), default="pending", server_default="pending", nullable=False)
    last_error: Mapped[str | None] = mapped_column(String(1024))

    anime: Mapped[AnimeMetaInfo] = relationship(back_populates="posters")


class Episode(TimestampedBase):
    __tablename__ = "episode"
    __table_args__ = (
        UniqueConstraint("anime_id", "episode_number", name="uq_episode_anime_id_episode_number"),
        Index("ix_episode_anime_id_episode_number", "anime_id", "episode_number"),
        Index("ix_episode_air_at", "air_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    anime_id: Mapped[int] = mapped_column(
        ForeignKey("anime_meta_info.id", ondelete="CASCADE"),
        nullable=False,
    )
    episode_number: Mapped[int] = mapped_column(Integer, nullable=False)
    original_title: Mapped[str | None] = mapped_column(String(255))
    air_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[EpisodeStatus] = mapped_column(
        Enum(
            EpisodeStatus,
            name="episode_status",
            values_callable=enum_values,
        ),
        default=EpisodeStatus.UNKNOWN,
        server_default=EpisodeStatus.UNKNOWN.value,
        nullable=False,
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    anime: Mapped[AnimeMetaInfo] = relationship(back_populates="episodes")
    names: Mapped[list[EpisodeName]] = relationship(
        back_populates="episode",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    user_progresses: Mapped[list[UserEpisodeProgress]] = relationship(
        back_populates="episode",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    @validates("duration")
    def _validate_duration(self, _key: str, duration: str | None) -> str | None:
        return validate_duration(duration)


class EpisodeName(TimestampedBase):
    __tablename__ = "episode_name"
    __table_args__ = (UniqueConstraint("episode_id", "name", name="uq_episode_name_episode_id_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("episode.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    language: Mapped[str | None] = mapped_column(String(32))

    episode: Mapped[Episode] = relationship(back_populates="names")
