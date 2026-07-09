from __future__ import annotations

from abc import ABC, abstractmethod

from app.import_provider.types import ImportAnimeDetail, ImportSearchPage


class ImportProvider(ABC):
    name: str

    @abstractmethod
    def search_anime(self, keyword: str, *, limit: int, offset: int) -> ImportSearchPage: ...

    @abstractmethod
    def get_anime_detail(self, external_id: str) -> ImportAnimeDetail: ...
