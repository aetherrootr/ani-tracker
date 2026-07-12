from __future__ import annotations

from pathlib import Path

import pytest
from click.testing import CliRunner
from sqlalchemy import select

from app import create_app
from app.api.utils.auth import hash_password, verify_password
from app.main import celery_app, gunicorn_timeout, main
from app.models.user import User


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


def test_cli_reset_password_sets_generated_password(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv('DATABASE_URL', database_url)
    app = create_app({'DATABASE_URL': database_url, 'TESTING': True})
    session_factory = app.extensions['db_session_factory']
    with session_factory() as session:
        session.add(
            User(
                username='link',
                email='link@example.test',
                password_hash=hash_password('oldpassword123'),
            ),
        )
        session.commit()

    result = CliRunner().invoke(main, ['reset-password', 'link'])

    assert result.exit_code == 0
    password = result.output.strip()
    assert len(password) == 12
    with session_factory() as session:
        user = session.scalar(select(User).where(User.username == 'link'))
        assert user is not None
        assert verify_password(user.password_hash, password)


def test_cli_reset_password_rejects_unknown_user(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv('DATABASE_URL', database_url)
    create_app({'DATABASE_URL': database_url, 'TESTING': True})

    result = CliRunner().invoke(main, ['reset-password', 'missing'])

    assert result.exit_code != 0
    assert 'User not found: missing' in result.output
