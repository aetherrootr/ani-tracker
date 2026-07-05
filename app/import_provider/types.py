from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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
