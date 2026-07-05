from __future__ import annotations

from dataclasses import asdict
from typing import Any

from flask import current_app

from app.import_provider.factory import ImportProviderFactory
from app.import_provider.types import ImportSearchResult


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


def get_import_provider_factory() -> ImportProviderFactory:
    factory = current_app.extensions['import_provider_factory']
    if not isinstance(factory, ImportProviderFactory):
        message = 'Import provider factory is not initialized'
        raise RuntimeError(message)
    return factory


def serialize_import_search_result(result: ImportSearchResult) -> dict[str, Any]:
    data = asdict(result)
    return {
        'provider': data['provider'],
        'externalId': data['external_id'],
        'title': data['title'],
        'originalTitle': data['original_title'],
        'summary': data['summary'],
        'airDate': data['air_date'],
        'platform': data['platform'],
        'episodeCount': data['episode_count'],
        'imageUrl': data['image_url'],
        'url': data['url'],
        'rawData': data['raw_data'],
    }
