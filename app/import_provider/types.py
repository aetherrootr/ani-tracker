from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any


class ProviderType(enum.StrEnum):
    BANGUMI = 'bangumi'
    TMDB = 'tmdb'
    TVDB = 'tvdb'


class ProviderUpdateMethod(enum.IntEnum):
    CREATE = 1
    UPDATE = 2
    DELETE = 3


@dataclass(frozen=True)
class ImportProviderUpdate:
    entity_type: str
    record_id: int | str
    timestamp: int
    method: ProviderUpdateMethod
    # Optional provider-specific parent record ID, such as a TVDB series ID for an episode update.
    parent_id: int | str | None = None
    affected_external_ids: tuple[str, ...] = ()
    raw_data: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ImportProviderUpdateBatch:
    updates: list[ImportProviderUpdate] = field(default_factory=list)
    next_page: int | None = None


@dataclass(frozen=True)
class ImportSearchResult:
    provider: str
    external_id: str
    title: str
    original_title: str | None
    summary: str | None
    air_date: str | None
    platform: str | None
    episode_count: int | None
    image_url: str | None
    url: str
    raw_data: dict[str, Any]


@dataclass(frozen=True)
class ImportSearchPage:
    total: int
    limit: int
    offset: int
    results: list[ImportSearchResult]


@dataclass(frozen=True)
class ImportAnimeName:
    name: str
    language: str | None


@dataclass(frozen=True)
class ImportEpisodeName:
    name: str
    language: str | None


@dataclass(frozen=True)
class ImportAnimeSummary:
    language: str
    summary: str


@dataclass(frozen=True)
class ImportEpisodeInfo:
    provider: str
    external_id: str | None
    episode_number: int
    title: str | None
    names: list[ImportEpisodeName]
    air_at: datetime | None
    duration: str | None
    status: str
    url: str | None
    raw_data: dict[str, Any]
    air_at_has_time: bool = False
    status_air_at: datetime | None = None


@dataclass(frozen=True)
class ImportRelatedAnime:
    provider: str
    external_id: str
    title: str
    relation_type: str
    season_number: int | None
    air_date: date | None
    episode_count: int | None
    url: str | None
    poster_source_url: str | None
    raw_data: dict[str, Any]
    titles: list[ImportAnimeName] = field(default_factory=list)


@dataclass(frozen=True)
class ImportAnimeDetail:
    provider: str
    external_id: str
    title: str
    original_title: str | None
    summaries: list[ImportAnimeSummary]
    poster_source_url: str | None
    anime_type: str
    total_episodes: int | None
    url: str
    names: list[ImportAnimeName]
    episodes: list[ImportEpisodeInfo]
    raw_data: dict[str, Any]
    air_date: date | None = None
    related_anime: list[ImportRelatedAnime] = field(default_factory=list)
