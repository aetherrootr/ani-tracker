from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from app.import_provider.exceptions import ImportProviderResponseError


def build_external_id(series_id: int | str, season_number: int | str) -> str:
    return f'{series_id}:{season_number}'


def parse_external_id(external_id: str) -> tuple[str, int]:
    parts = external_id.split(':')
    if len(parts) != 2 or not parts[0] or not parts[1]:
        message = 'Invalid TVDB external id'
        raise ImportProviderResponseError(message)
    try:
        return parts[0], int(parts[1])
    except ValueError as exc:
        message = 'Invalid TVDB external id'
        raise ImportProviderResponseError(message) from exc


def coerce_int(value: object, default: int | None = None) -> int | None:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return int(value)
        except ValueError:
            return default
    return default


def parse_date(value: object) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def parse_air_at(value: object) -> datetime | None:
    parsed = parse_date(value)
    if parsed is None:
        return None
    return datetime(parsed.year, parsed.month, parsed.day, tzinfo=UTC)


def map_status(air_at: datetime | None) -> str:
    if air_at is None:
        return 'unknown'
    return 'aired' if air_at.date() <= datetime.now(UTC).date() else 'upcoming'


def runtime_to_duration(minutes: object) -> str | None:
    value = coerce_int(minutes)
    if value is None or value <= 0:
        return None
    return f'{value // 60:02d}:{value % 60:02d}:00'


def tvdb_language(language: str | None) -> str | None:
    if not isinstance(language, str) or not language.strip():
        return None
    normalized = language.strip().lower().replace('_', '-')
    mapping = {
        'en': 'eng',
        'en-us': 'eng',
        'zh': 'zho',
        'zh-cn': 'zho',
        'zh-hans': 'zho',
        'zh-tw': 'zho',
        'zh-hant': 'zho',
        'ja': 'jpn',
        'ja-jp': 'jpn',
        'ko': 'kor',
        'ko-kr': 'kor',
    }
    if normalized in mapping:
        return mapping[normalized]
    return normalized if len(normalized) == 3 and normalized.isalpha() else None


def is_aired_order_season(season: dict[str, Any]) -> bool:
    season_type = season.get('type')
    values: list[str] = []
    if isinstance(season_type, dict):
        values.extend(str(season_type.get(key, '')).lower() for key in ('type', 'name', 'alternateName'))
    elif isinstance(season_type, str):
        values.append(season_type.lower())
    if not values:
        return True
    return any(value in {'default', 'official'} or 'aired' in value or 'official' in value for value in values)


def normalize_image_url(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.startswith('http://') or text.startswith('https://'):
        return text
    if text.startswith('//'):
        return f'https:{text}'
    if text.startswith('/'):
        return f'https://artworks.thetvdb.com{text}'
    return f'https://artworks.thetvdb.com/{text}'


def first_non_empty(*values: object) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value
    return None
