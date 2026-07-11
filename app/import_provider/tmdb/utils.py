from __future__ import annotations

from datetime import UTC, date, datetime

from app.import_provider.exceptions import ImportProviderResponseError


def build_movie_external_id(movie_id: int | str) -> str:
    return f'movie:{movie_id}'


def build_tv_season_external_id(series_id: int | str, season_number: int | str) -> str:
    return f'tv:{series_id}:season:{season_number}'


def parse_external_id(external_id: str) -> tuple[str, str, int | None]:
    parts = external_id.split(':')
    if len(parts) == 2 and parts[0] == 'movie' and parts[1]:
        return 'movie', parts[1], None
    if len(parts) == 4 and parts[0] == 'tv' and parts[1] and parts[2] == 'season' and parts[3]:
        try:
            season_number = int(parts[3])
        except ValueError as exc:
            message = 'Invalid TMDB external id'
            raise ImportProviderResponseError(message) from exc
        return 'tv', parts[1], season_number
    message = 'Invalid TMDB external id'
    raise ImportProviderResponseError(message)


def parse_date(value: object) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip())
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
    if not isinstance(minutes, int) or isinstance(minutes, bool) or minutes <= 0:
        return None
    return f'{minutes // 60:02d}:{minutes % 60:02d}:00'
