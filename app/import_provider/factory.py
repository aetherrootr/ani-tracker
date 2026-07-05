from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.import_provider.bangumi import BangumiImportProvider
from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import ImportProviderResponseError


class ImportProviderFactory:
    def __init__(self, providers: Mapping[str, ImportProvider]) -> None:
        self._providers = dict(providers)

    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> ImportProviderFactory:
        provider = BangumiImportProvider(
            base_url=str(config['BANGUMI_API_BASE_URL']),
            web_base_url=str(config['BANGUMI_WEB_BASE_URL']),
            user_agent=str(config['BANGUMI_USER_AGENT']),
            timeout=float(config['IMPORT_PROVIDER_TIMEOUT']),
        )
        return cls({provider.name: provider})

    def get_provider(self, name: str) -> ImportProvider:
        provider = self._providers.get(name)
        if provider is None:
            message = 'Unknown import provider'
            raise ImportProviderResponseError(message)
        return provider
