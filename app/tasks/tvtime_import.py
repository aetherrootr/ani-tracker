from __future__ import annotations

import logging
import os
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.import_provider import ImportProviderFactory
from app.models.user import User
from app.services.tvtime_import import TvtimeImportOptions, run_tvtime_import
from app.services.tvtime_import.jobs import cleanup_input_files, load_input_files, update_job
from app.utils import env_bool, env_float

logger = logging.getLogger(__name__)


@celery_app.task(name='app.tasks.tvtime_import.run_tvtime_import_job')
def run_tvtime_import_job(
    job_id: str,
    user_id: int,
    input_path: str,
    report_dir: str,
    database_url: str | None,
    options_data: dict[str, Any],
) -> dict[str, Any]:
    database_url = database_url or str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    options = TvtimeImportOptions(
        backend=str(options_data.get('backend') or 'tvdb'),
        dry_run=bool(options_data.get('dryRun', True)),
        include_followed=bool(options_data.get('includeFollowed', True)),
        include_specials=bool(options_data.get('includeSpecials', True)),
        tvdb_workers=int(options_data.get('tvdbWorkers') or 2),
    )
    engine = None
    try:
        ensure_database_current(database_url)
        update_job(report_dir, job_id, status='running')
        connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
        engine = create_engine(database_url, connect_args=connect_args)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        files = load_input_files(input_path)
        provider_config = _provider_config()
        provider = ImportProviderFactory.from_config(provider_config).get_provider(options.backend)
        with session_factory() as session:
            user = session.get(User, user_id)
            if user is None:
                msg = 'Import user no longer exists'
                raise ValueError(msg)

            def progress_callback(progress: dict[str, Any], summary: dict[str, Any]) -> None:
                update_job(report_dir, job_id, progress=progress, summary=summary)

            report = run_tvtime_import(
                session,
                user,
                provider,
                files,
                options,
                progress_callback=progress_callback,
                provider_factory=lambda: ImportProviderFactory.from_config(provider_config).get_provider(options.backend),
            )
    except Exception as exc:
        logger.warning('TV Time import job %s failed', job_id, exc_info=True)
        report = _failure_report(options, exc)
        update_job(report_dir, job_id, status='failed', report=report, progress=report['progress'], summary=report['summary'])
        return {'status': 'failed', 'jobId': job_id}
    finally:
        cleanup_input_files(input_path)
        if engine is not None:
            engine.dispose()
    update_job(report_dir, job_id, status='completed', report=report, progress=report['progress'], summary=report['summary'])
    return {'status': 'completed', 'jobId': job_id}


def _failure_report(options: TvtimeImportOptions, exc: Exception) -> dict[str, Any]:
    return {
        'summary': {'providerFailures': 1, 'unresolvedRecords': 0},
        'progress': {'stage': 'failed', 'processed': 0, 'total': 1, 'percent': 0, 'message': str(exc)},
        'backend': options.backend,
        'languagePreference': None,
        'dryRun': options.dry_run,
        'includeSpecials': options.include_specials,
        'unresolved': [],
        'providerFailures': [{'errorType': type(exc).__name__, 'message': str(exc)}],
        'relatedAnimeWarnings': [],
        'extraWatchEvents': [],
    }


def _provider_config() -> dict[str, object]:
    return {
        'BANGUMI_API_BASE_URL': os.environ.get('BANGUMI_API_BASE_URL', 'https://api.bgm.tv'),
        'BANGUMI_WEB_BASE_URL': os.environ.get('BANGUMI_WEB_BASE_URL', 'https://bgm.tv'),
        'BANGUMI_USER_AGENT': os.environ.get(
            'BANGUMI_USER_AGENT',
            'ani-tracker/0.0.1 (https://github.com/aetherrootr/ani-tracker)',
        ),
        'TMDB_API_BASE_URL': os.environ.get('TMDB_API_BASE_URL', 'https://api.themoviedb.org/3'),
        'TMDB_WEB_BASE_URL': os.environ.get('TMDB_WEB_BASE_URL', 'https://www.themoviedb.org'),
        'TMDB_IMAGE_BASE_URL': os.environ.get('TMDB_IMAGE_BASE_URL', 'https://image.tmdb.org/t/p'),
        'TMDB_POSTER_SIZE': os.environ.get('TMDB_POSTER_SIZE', 'w500'),
        'TMDB_ACCESS_TOKEN': os.environ.get('TMDB_ACCESS_TOKEN'),
        'TMDB_API_KEY': os.environ.get('TMDB_API_KEY'),
        'TMDB_INCLUDE_ADULT': env_bool('TMDB_INCLUDE_ADULT'),
        'TVDB_API_BASE_URL': os.environ.get('TVDB_API_BASE_URL', 'https://api4.thetvdb.com/v4'),
        'TVDB_WEB_BASE_URL': os.environ.get('TVDB_WEB_BASE_URL', 'https://thetvdb.com'),
        'TVDB_API_KEY': os.environ.get('TVDB_API_KEY'),
        'TVDB_PIN': os.environ.get('TVDB_PIN'),
        'IMPORT_PROVIDER_TIMEOUT': env_float('IMPORT_PROVIDER_TIMEOUT', default=5, minimum=0),
    }
