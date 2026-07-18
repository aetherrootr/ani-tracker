from __future__ import annotations

import math
from typing import Literal

from app.models.progress import UserAnimeStatus

LibrarySort = Literal['updated_at', 'name', 'air_date']
LibraryOrder = Literal['asc', 'desc']
LibraryListFilter = Literal['all', 'tracking', 'backlog']
LibrarySeasonZeroFilter = Literal['include', 'exclude', 'only']
EpisodeFilter = Literal['all', 'watched', 'unwatched']
EpisodeOrder = Literal['asc', 'desc']

_LIBRARY_SORT_ALIASES: dict[str, LibrarySort] = {
    'updated_at': 'updated_at',
    'updatedAt': 'updated_at',
    'name': 'name',
    'air_date': 'air_date',
    'airDate': 'air_date',
}


def parse_search_limit(value: str | None) -> tuple[int, str | None]:
    if value is None:
        return 20, None
    try:
        limit = int(value)
    except ValueError:
        return 0, 'Search limit is invalid'
    if limit < 1 or limit > 50:
        return 0, 'Search limit is invalid'
    return limit, None


def parse_search_offset(value: str | None) -> tuple[int, str | None]:
    if value is None:
        return 0, None
    try:
        offset = int(value)
    except ValueError:
        return 0, 'Search offset is invalid'
    if offset < 0:
        return 0, 'Search offset is invalid'
    return offset, None


def parse_library_limit(value: str | None, *, default: int = 20, maximum: int = 500) -> tuple[int, str | None]:
    if value is None:
        return default, None
    try:
        limit = int(value)
    except ValueError:
        return 0, 'Pagination limit is invalid'
    if limit < 1 or limit > maximum:
        return 0, 'Pagination limit is invalid'
    return limit, None


def parse_library_offset(value: str | None) -> tuple[int, str | None]:
    if value is None:
        return 0, None
    try:
        offset = int(value)
    except ValueError:
        return 0, 'Pagination offset is invalid'
    if offset < 0:
        return 0, 'Pagination offset is invalid'
    return offset, None


def parse_episode_filter(value: str | None) -> tuple[EpisodeFilter, str | None]:
    if value is None or value == '':
        return 'all', None
    if value not in {'all', 'watched', 'unwatched'}:
        return 'all', 'Episode filter is invalid'
    return value, None  # type: ignore[return-value]


def parse_episode_order(value: str | None) -> tuple[EpisodeOrder, str | None]:
    if value is None or value == '':
        return 'asc', None
    if value not in {'asc', 'desc'}:
        return 'asc', 'Episode order is invalid'
    return value, None  # type: ignore[return-value]


def parse_optional_positive_int(value: str | None, *, label: str) -> tuple[int | None, str | None]:
    if value is None or value == '':
        return None, None
    try:
        parsed = int(value)
    except ValueError:
        return None, f'{label} is invalid'
    if parsed < 1:
        return None, f'{label} is invalid'
    return parsed, None


def parse_library_status(value: str | None) -> tuple[UserAnimeStatus | None, str | None]:
    if value is None or value == '' or value == 'all':
        return None, None
    try:
        status = UserAnimeStatus(value)
    except ValueError:
        return None, 'Library status is invalid'
    if status == UserAnimeStatus.DROPPED:
        return None, 'Library status is invalid'
    return status, None


def parse_library_sort(value: str | None) -> tuple[LibrarySort, str | None]:
    if value is None or value == '':
        return 'updated_at', None
    sort = _LIBRARY_SORT_ALIASES.get(value)
    if sort is None:
        return 'updated_at', 'Library sort is invalid'
    return sort, None


def parse_library_order(value: str | None) -> tuple[LibraryOrder, str | None]:
    if value is None or value == '':
        return 'desc', None
    if value not in {'asc', 'desc'}:
        return 'desc', 'Library order is invalid'
    return value, None  # type: ignore[return-value]


def parse_library_list_filter(value: str | None) -> tuple[LibraryListFilter, str | None]:
    if value is None or value == '':
        return 'all', None
    if value not in {'all', 'tracking', 'backlog'}:
        return 'all', 'Library list filter is invalid'
    return value, None  # type: ignore[return-value]


def parse_library_season_zero_filter(value: str | None) -> tuple[LibrarySeasonZeroFilter, str | None]:
    if value is None or value == '':
        return 'exclude', None
    if value not in {'include', 'exclude', 'only'}:
        return 'exclude', 'Library season zero filter is invalid'
    return value, None  # type: ignore[return-value]


def total_pages(total: int, limit: int) -> int:
    return math.ceil(total / limit) if total > 0 else 0
