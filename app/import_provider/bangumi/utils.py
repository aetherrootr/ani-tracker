from __future__ import annotations

import re
from datetime import UTC, date, datetime

from app.import_provider.utils import coerce_int


def pick_episode_count(subject: dict[object, object] | dict[str, object]) -> int | None:
    eps = coerce_int(subject.get('eps'))
    if eps is not None:
        return eps
    return coerce_int(subject.get('total_episodes'))


def pick_image_url(images: object) -> str | None:
    if not isinstance(images, dict):
        return None

    for key in ('medium', 'common', 'grid', 'large', 'small'):
        image_url = images.get(key)
        if isinstance(image_url, str) and image_url.strip():
            return image_url
    return None


def map_anime_type(platform: str | None) -> str:
    if platform == 'TV':
        return 'tv'
    if platform in {'剧场版', 'Movie'}:
        return 'movie'
    if platform == 'OVA':
        return 'ova'
    if platform in {'WEB', 'ONA'}:
        return 'ona'
    return 'unknown'


def parse_air_at(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = date.fromisoformat(value.strip())
    except ValueError:
        return None
    return datetime(parsed.year, parsed.month, parsed.day, tzinfo=UTC)


def map_episode_status(air_at: datetime | None) -> str:
    if air_at is None:
        return 'unknown'
    today = datetime.now(UTC).date()
    return 'aired' if air_at.date() <= today else 'upcoming'


def parse_duration(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    duration = value.strip()
    if re.fullmatch(r'\d{2}:\d{2}:\d{2}', duration):
        return duration
    match = re.fullmatch(r'(\d+)m', duration)
    if match is not None:
        minutes = int(match.group(1))
        return f'{minutes // 60:02d}:{minutes % 60:02d}:00'
    return None
