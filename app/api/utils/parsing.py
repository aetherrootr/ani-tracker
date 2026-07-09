from __future__ import annotations

import math
from typing import Literal

from app.models.progress import UserAnimeStatus

LibrarySort = Literal['updated_at', 'name', 'air_date']
LibraryOrder = Literal['asc', 'desc']

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


def total_pages(total: int, limit: int) -> int:
    return math.ceil(total / limit) if total > 0 else 0
