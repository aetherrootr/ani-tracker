from __future__ import annotations


def coerce_int(value: object, default: int | None = None) -> int | None:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    return default


def non_empty_str(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None
