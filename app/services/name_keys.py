from __future__ import annotations

import re
import unicodedata

try:
    from pypinyin import lazy_pinyin
except ImportError:  # pragma: no cover - dependency is declared, fallback keeps app importable.
    lazy_pinyin = None  # type: ignore[assignment]


_CJK_RE = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')
_SPACE_RE = re.compile(r'\s+')


def build_name_keys(name: str) -> tuple[str, str, str]:
    normalized = normalize_text(name)
    pinyin_parts = _pinyin_parts(name)
    pinyin_text = ' '.join(pinyin_parts)
    compact_pinyin = ''.join(pinyin_parts)
    initials = ''.join(part[0] for part in pinyin_parts if part)

    sort_key = compact_pinyin if _contains_cjk(name) and compact_pinyin else normalized
    initial_key = _initial_key(name, pinyin_parts)
    search_key = ' '.join(
        dict.fromkeys(
            item
            for item in (
                normalized,
                normalized.replace(' ', ''),
                pinyin_text,
                compact_pinyin,
                initials,
            )
            if item
        ),
    )
    return sort_key, initial_key, search_key


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize('NFKC', value).strip().casefold()
    return _SPACE_RE.sub(' ', normalized)


def build_search_key(value: str) -> str:
    return build_name_keys(value)[2]


def _contains_cjk(value: str) -> bool:
    return _CJK_RE.search(value) is not None


def _pinyin_parts(value: str) -> list[str]:
    if lazy_pinyin is None:
        return [part for part in re.split(r'\W+', normalize_text(value)) if part]
    return [normalize_text(part) for part in lazy_pinyin(value) if normalize_text(part)]


def _initial_key(value: str, pinyin_parts: list[str]) -> str:
    for char in value.strip():
        if char.isspace():
            continue
        if _contains_cjk(char):
            first_part = next((part for part in pinyin_parts if part), '')
            return first_part[0] if first_part and first_part[0].isalpha() else '#'
        normalized = normalize_text(char)
        if normalized and normalized[0].isalpha() and normalized[0].isascii():
            return normalized[0]
        return '#'
    return '#'
