from __future__ import annotations

from typing import Protocol

from app.import_provider.types import ImportAnimeDetail, ImportSearchPage


class ImportProvider(Protocol):
    name: str

    def search_anime(self, keyword: str, *, limit: int, offset: int) -> ImportSearchPage: ...

    def get_anime_detail(self, external_id: str) -> ImportAnimeDetail: ...
