from __future__ import annotations

from pathlib import Path

import pytest

from app import create_app
from app.main import gunicorn_timeout


def test_gunicorn_timeout_defaults_to_120(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv('GUNICORN_TIMEOUT', raising=False)

    assert gunicorn_timeout() == 120


def test_gunicorn_timeout_reads_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('GUNICORN_TIMEOUT', '45')

    assert gunicorn_timeout() == 45


def test_import_provider_timeout_reads_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv('IMPORT_PROVIDER_TIMEOUT', '10.5')

    app = create_app(
        {
            'DATABASE_URL': f"sqlite:///{tmp_path / 'test.db'}",
            'MIGRATE_DATABASE': False,
            'TESTING': True,
        },
    )

    assert app.config['IMPORT_PROVIDER_TIMEOUT'] == pytest.approx(10.5)
