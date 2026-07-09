from __future__ import annotations

from flask import current_app

from app.import_provider.factory import ImportProviderFactory


def get_import_provider_factory() -> ImportProviderFactory:
    factory = current_app.extensions['import_provider_factory']
    if not isinstance(factory, ImportProviderFactory):
        message = 'Import provider factory is not initialized'
        raise RuntimeError(message)
    return factory
