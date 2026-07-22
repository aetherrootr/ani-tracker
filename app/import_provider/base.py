from __future__ import annotations

from abc import ABC, abstractmethod

from app.import_provider.types import ImportAnimeDetail, ImportProviderUpdateBatch, ImportSearchPage


class ImportProvider(ABC):
    name: str
    update_streams: tuple[str, ...] = ()

    @property
    def supports_updates(self) -> bool:
        return bool(self.update_streams) and type(self).get_updates is not ImportProvider.get_updates

    @abstractmethod
    def search_anime(self, keyword: str, *, limit: int, offset: int, language: str | None = None) -> ImportSearchPage: ...

    @abstractmethod
    def get_anime_detail(self, external_id: str, *, language: str | None = None) -> ImportAnimeDetail: ...

    def get_updates(self, *, since: int, stream: str, page: int = 0, max_pages: int = 100) -> ImportProviderUpdateBatch:
        _ = since, stream, page, max_pages
        return ImportProviderUpdateBatch()
