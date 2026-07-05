from __future__ import annotations


class ImportProviderError(Exception):
    """Base error for import provider failures."""


class ImportProviderTimeoutError(ImportProviderError):
    """Raised when an import provider request times out."""


class ImportProviderResponseError(ImportProviderError):
    """Raised when an import provider returns an unusable response."""
