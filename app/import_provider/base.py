from __future__ import annotations

from typing import Protocol

from app.import_provider.types import ImportSearchPage


class ImportProvider(Protocol):
    name: str

    def search_anime(self, keyword: str, *, limit: int, offset: int) -> ImportSearchPage: ...
