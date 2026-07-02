from __future__ import annotations

import enum
import re

_DURATION_PATTERN = re.compile(r"^\d{2}:\d{2}:\d{2}$")


class ProviderType(enum.StrEnum):
    BANGUMI = "bangumi"


def validate_duration(duration: str | None) -> str | None:
    if duration is None:
        return None
    if _DURATION_PATTERN.fullmatch(duration) is None:
        msg = f"Duration must use HH:MM:SS format: {duration!r}"
        raise ValueError(msg)
    return duration


def validate_provider_type(provider_type: ProviderType | str) -> str:
    try:
        return ProviderType(provider_type).value
    except ValueError as exc:
        msg = f"Unsupported provider_type: {provider_type!r}"
        raise ValueError(msg) from exc


def validate_pagination(limit: int, offset: int, *, max_limit: int = 200) -> tuple[int, int]:
    if limit < 1:
        msg = "limit must be greater than 0"
        raise ValueError(msg)
    if limit > max_limit:
        msg = f"limit must be less than or equal to {max_limit}"
        raise ValueError(msg)
    if offset < 0:
        msg = "offset must be greater than or equal to 0"
        raise ValueError(msg)
    return limit, offset
