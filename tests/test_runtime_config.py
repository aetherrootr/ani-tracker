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


def test_import_provider_timeout_reads_environment(monkeypatch: pytest.MonkeyPatch, test_instance_path: Path) -> None:
    monkeypatch.setenv('IMPORT_PROVIDER_TIMEOUT', '10.5')

    app = create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'test.db'}",
            'MIGRATE_DATABASE': False,
            'TESTING': True,
        },
    )

    assert app.config['IMPORT_PROVIDER_TIMEOUT'] == pytest.approx(10.5)


def test_import_search_timeout_reads_environment(monkeypatch: pytest.MonkeyPatch, test_instance_path: Path) -> None:
    monkeypatch.setenv('IMPORT_SEARCH_TIMEOUT', '12.5')

    app = create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'test.db'}",
            'MIGRATE_DATABASE': False,
            'TESTING': True,
        },
    )

    assert app.config['IMPORT_SEARCH_TIMEOUT'] == pytest.approx(12.5)


def test_auto_import_cron_defaults_are_randomized_overnight(monkeypatch: pytest.MonkeyPatch, test_instance_path: Path) -> None:
    for name in (
        'AUTO_IMPORT_TVDB_SEASONS_CRON_DAY',
        'AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR',
        'AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE',
        'AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY',
        'AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR',
        'AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE',
    ):
        monkeypatch.delenv(name, raising=False)

    app = create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'cron-defaults.db'}",
            'MIGRATE_DATABASE': False,
            'TESTING': True,
        },
    )

    assert 1 <= app.config['AUTO_IMPORT_TVDB_SEASONS_CRON_DAY'] <= 28
    assert 1 <= app.config['AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR'] <= 3
    assert 0 <= app.config['AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE'] <= 59
    assert 1 <= app.config['AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY'] <= 28
    assert 3 <= app.config['AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR'] <= 5
    assert 0 <= app.config['AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE'] <= 59


def test_auto_import_cron_environment_overrides_random_defaults(monkeypatch: pytest.MonkeyPatch, test_instance_path: Path) -> None:
    monkeypatch.setenv('AUTO_IMPORT_TVDB_SEASONS_CRON_DAY', '11')
    monkeypatch.setenv('AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR', '12')
    monkeypatch.setenv('AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE', '13')
    monkeypatch.setenv('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY', '14')
    monkeypatch.setenv('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR', '15')
    monkeypatch.setenv('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE', '16')

    app = create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'cron-overrides.db'}",
            'MIGRATE_DATABASE': False,
            'TESTING': True,
        },
    )

    assert app.config['AUTO_IMPORT_TVDB_SEASONS_CRON_DAY'] == 11
    assert app.config['AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR'] == 12
    assert app.config['AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE'] == 13
    assert app.config['AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY'] == 14
    assert app.config['AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR'] == 15
    assert app.config['AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE'] == 16


def test_untracked_anime_cleanup_disabled_defaults_to_true(test_instance_path: Path) -> None:
    app = create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'cleanup-default.db'}",
            'MIGRATE_DATABASE': False,
            'TESTING': True,
        },
    )

    assert app.config['UNTRACKED_ANIME_CLEANUP_DISABLED'] is True
    assert 'delete-untracked-anime' not in celery_app.conf.beat_schedule


def test_untracked_anime_cleanup_disabled_reads_environment(monkeypatch: pytest.MonkeyPatch, test_instance_path: Path) -> None:
    monkeypatch.setenv('UNTRACKED_ANIME_CLEANUP_DISABLED', 'true')

    app = create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'cleanup-disabled.db'}",
            'MIGRATE_DATABASE': False,
            'TESTING': True,
        },
    )

    assert app.config['UNTRACKED_ANIME_CLEANUP_DISABLED'] is True
    assert 'delete-untracked-anime' not in celery_app.conf.beat_schedule


def test_instance_path_reads_environment(test_instance_path: Path) -> None:
    app = create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'test.db'}",
            'MIGRATE_DATABASE': False,
            'TESTING': True,
        },
    )

    assert Path(app.instance_path) == test_instance_path
    assert app.config['ANIME_POSTER_STORAGE_DIR'] == str(test_instance_path / 'anime_posters')
    assert app.config['USER_WALLPAPER_STORAGE_DIR'] == str(test_instance_path / 'user_wallpapers')
    assert app.config['USER_WALLPAPER_MAX_IMAGES_PER_USER'] == 12
    assert app.config['TVTIME_IMPORT_REPORT_DIR'] == str(test_instance_path / 'tvtime_import_reports')
    assert app.config['LIBRARY_REFRESH_JOB_LOCK_DIR'] == str(test_instance_path / 'library_refresh_jobs')


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


def test_cli_worker_subcommand_can_run_beat(monkeypatch: pytest.MonkeyPatch) -> None:
    worker_args: list[list[str]] = []

    def worker_main(argv: list[str]) -> None:
        worker_args.append(argv)

    monkeypatch.setattr(celery_app, 'worker_main', worker_main)

    result = CliRunner().invoke(main, ['worker', '--beat', '--schedule', 'celerybeat-schedule'])

    assert result.exit_code == 0
    assert worker_args == [['worker', '--loglevel', 'info', '--beat', '--schedule', 'celerybeat-schedule']]


def test_cli_beat_subcommand_starts_celery_beat(monkeypatch: pytest.MonkeyPatch) -> None:
    beat_args: list[list[str]] = []

    def start(argv: list[str]) -> None:
        beat_args.append(argv)

    monkeypatch.setattr(celery_app, 'start', start)

    result = CliRunner().invoke(main, ['beat', '--loglevel', 'debug', '--schedule', 'celerybeat-schedule'])

    assert result.exit_code == 0
    assert beat_args == [['beat', '--loglevel', 'debug', '--schedule', 'celerybeat-schedule']]


def test_cli_reset_password_sets_generated_password(monkeypatch: pytest.MonkeyPatch, test_instance_path: Path) -> None:
    database_url = f"sqlite:///{test_instance_path / 'test.db'}"
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


def test_cli_reset_password_rejects_unknown_user(monkeypatch: pytest.MonkeyPatch, test_instance_path: Path) -> None:
    database_url = f"sqlite:///{test_instance_path / 'test.db'}"
    monkeypatch.setenv('DATABASE_URL', database_url)
    create_app({'DATABASE_URL': database_url, 'TESTING': True})

    result = CliRunner().invoke(main, ['reset-password', 'missing'])

    assert result.exit_code != 0
    assert 'User not found: missing' in result.output
