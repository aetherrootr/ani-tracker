from __future__ import annotations

import os
from pathlib import Path
from typing import cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


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


def local_timezone(value: object | None = None) -> str:
    for candidate in (value, os.environ.get('TZ'), _timezone_from_localtime()):
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
