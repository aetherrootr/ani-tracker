from __future__ import annotations

import os
from pathlib import Path
from typing import cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from celery.schedules import crontab_parser


def safe_int(value: object, *, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        parsed = int(cast(str, value))
    except (TypeError, ValueError):
        return default
    if minimum is not None and parsed < minimum:
        return default
    if maximum is not None and parsed > maximum:
        return default
    return parsed


def safe_float(value: object, *, default: float, minimum: float | None = None, maximum: float | None = None) -> float:
    try:
        parsed = float(cast(str, value))
    except (TypeError, ValueError):
        return default
    if minimum is not None and parsed < minimum:
        return default
    if maximum is not None and parsed > maximum:
        return default
    return parsed


def env_bool(name: str, *, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {'1', 'true', 'yes', 'on'}


def env_int(name: str, *, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    return safe_int(os.environ.get(name, str(default)), default=default, minimum=minimum, maximum=maximum)


def env_float(name: str, *, default: float, minimum: float | None = None, maximum: float | None = None) -> float:
    return safe_float(os.environ.get(name, str(default)), default=default, minimum=minimum, maximum=maximum)


def configured_instance_path(*, default: str | Path = 'instance') -> Path:
    return Path(os.environ.get('ANIME_TRACKER_INSTANCE_PATH') or default)


def safe_cron_months(value: object, *, default: str = '2,5,8,11') -> str:
    months = str(value or default)
    try:
        crontab_parser(12, 1).parse(months)
    except (KeyError, ValueError):
        return default
    return months


def safe_cron_hours(value: object, *, default: str = '4,12,20') -> str:
    hours = str(value or default)
    try:
        crontab_parser(24).parse(hours)
    except (KeyError, ValueError):
        return default
    return hours


def local_timezone(value: object | None = None, *, use_system_timezone: bool = True) -> str:
    candidates = (value, os.environ.get('TZ'), _timezone_from_localtime() if use_system_timezone else None)
    for candidate in candidates:
        if not isinstance(candidate, str) or not candidate.strip():
            continue
        timezone = candidate.strip()
        if _is_valid_timezone(timezone):
            return timezone
    return 'UTC'


def _is_valid_timezone(value: str) -> bool:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError:
        return False
    return True


def _timezone_from_localtime() -> str | None:
    localtime = Path('/etc/localtime')
    try:
        resolved = localtime.resolve(strict=True)
    except OSError:
        return None
    parts = resolved.parts
    if 'zoneinfo' not in parts:
        return None
    index = parts.index('zoneinfo')
    timezone_parts = parts[index + 1 :]
    return '/'.join(timezone_parts) if timezone_parts else None
