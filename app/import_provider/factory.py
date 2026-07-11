from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.import_provider.bangumi import BangumiImportProvider
from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import ImportProviderResponseError
from app.import_provider.tmdb import TmdbImportProvider


class ImportProviderFactory:
    def __init__(self, providers: Mapping[str, ImportProvider]) -> None:
        self._providers = dict(providers)

    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> ImportProviderFactory:
        bangumi_provider = BangumiImportProvider(
            base_url=str(config['BANGUMI_API_BASE_URL']),
            web_base_url=str(config['BANGUMI_WEB_BASE_URL']),
            user_agent=str(config['BANGUMI_USER_AGENT']),
            timeout=float(config['IMPORT_PROVIDER_TIMEOUT']),
        )
        providers: list[ImportProvider] = [bangumi_provider]
        tmdb_access_token = config.get('TMDB_ACCESS_TOKEN')
        tmdb_api_key = config.get('TMDB_API_KEY')
        has_tmdb_access_token = isinstance(tmdb_access_token, str) and bool(tmdb_access_token.strip())
        has_tmdb_api_key = isinstance(tmdb_api_key, str) and bool(tmdb_api_key.strip())
        if has_tmdb_access_token or has_tmdb_api_key:
            providers.append(
                TmdbImportProvider(
                    base_url=str(config['TMDB_API_BASE_URL']),
                    web_base_url=str(config['TMDB_WEB_BASE_URL']),
                    image_base_url=str(config['TMDB_IMAGE_BASE_URL']),
                    poster_size=str(config['TMDB_POSTER_SIZE']),
                    access_token=tmdb_access_token if isinstance(tmdb_access_token, str) else None,
                    api_key=tmdb_api_key if isinstance(tmdb_api_key, str) else None,
                    include_adult=bool(config['TMDB_INCLUDE_ADULT']),
                    timeout=float(config['IMPORT_PROVIDER_TIMEOUT']),
                ),
            )
        return cls({provider.name: provider for provider in providers})

    def get_provider(self, name: str) -> ImportProvider:
        provider = self._providers.get(name)
        if provider is None:
            message = 'Unknown import provider'
            raise ImportProviderResponseError(message)
        return provider
