from __future__ import annotations

from pathlib import Path

import pytest
from click.testing import CliRunner

from app import create_app
from app.main import celery_app, gunicorn_timeout, main


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


def test_cli_without_subcommand_runs_server(monkeypatch: pytest.MonkeyPatch) -> None:
    modes: list[str] = []

    def run_server(mode: str) -> None:
        modes.append(mode)

    monkeypatch.setattr('app.main.run_server', run_server)

    result = CliRunner().invoke(main, ['--dev'])

    assert result.exit_code == 0
    assert modes == ['dev']


def test_cli_server_subcommand_runs_server(monkeypatch: pytest.MonkeyPatch) -> None:
    modes: list[str] = []

    def run_server(mode: str) -> None:
        modes.append(mode)

    monkeypatch.setattr('app.main.run_server', run_server)

    result = CliRunner().invoke(main, ['server', '--prod'])

    assert result.exit_code == 0
    assert modes == ['prod']


def test_cli_worker_subcommand_starts_celery_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    worker_args: list[list[str]] = []

    def worker_main(argv: list[str]) -> None:
        worker_args.append(argv)

    monkeypatch.setattr(celery_app, 'worker_main', worker_main)

    result = CliRunner().invoke(main, ['worker', '--loglevel', 'debug', '--pool', 'solo'])

    assert result.exit_code == 0
    assert worker_args == [['worker', '--loglevel', 'debug', '--pool', 'solo']]
