from __future__ import annotations

import logging
import os

from sqlalchemy import create_engine, func, or_, select
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.import_provider import ImportProviderFactory
from app.models.anime import AnimeMetaInfo, Episode, EpisodeStatus
from app.models.progress import UserAnimeProgress
from app.services.anime_sync import sync_anime_from_provider
from app.services.library_refresh_jobs import (
    release_library_refresh_lock,
    update_library_refresh_job,
)
from app.tasks.anime_poster import download_anime_poster
from app.utils import configured_instance_path, env_bool, env_float, safe_float, safe_int

logger = logging.getLogger(__name__)


@celery_app.task(
    name='app.tasks.anime_sync.sync_airing_anime',
    autoretry_for=(Exception,),
    retry_kwargs={'countdown': 5 * 60, 'max_retries': 3},
)
def sync_airing_anime() -> dict[str, int]:
    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    provider_factory = ImportProviderFactory.from_config(_provider_config())
    summary = {'checked': 0, 'synced': 0, 'failed': 0, 'episodeConflicts': 0}
    with session_factory() as session:
        anime_ids = _airing_anime_ids(session)
        summary['checked'] = len(anime_ids)
        for anime_id in anime_ids:
            try:
                anime = session.get(AnimeMetaInfo, anime_id)
                if anime is None:
                    continue
                provider = provider_factory.get_provider(anime.provider_type)
                result = sync_anime_from_provider(session, provider, anime_id=anime_id)
                if result is None:
                    continue
                poster_ids = result.poster_ids_to_enqueue
                conflict_count = len(result.episode_conflicts)
                session.commit()
            except Exception:
                session.rollback()
                summary['failed'] += 1
                logger.warning('Failed to sync anime %s', anime_id, exc_info=True)
                continue
            for poster_id in poster_ids:
                _enqueue_poster_download(database_url, poster_id)
            if conflict_count:
                logger.info('Anime %s sync found %s episode conflicts', anime_id, conflict_count)
            summary['synced'] += 1
            summary['episodeConflicts'] += conflict_count
    return summary


@celery_app.task(name='app.tasks.anime_sync.sync_user_library_anime')
def sync_user_library_anime(user_id: int) -> dict[str, int]:
    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    provider_factory = ImportProviderFactory.from_config(_provider_config())
    summary = {'checked': 0, 'synced': 0, 'failed': 0, 'episodeConflicts': 0, 'postersQueued': 0}
    try:
        with session_factory() as session:
            anime_ids = session.scalars(
                select(UserAnimeProgress.anime_id).where(UserAnimeProgress.user_id == user_id).order_by(UserAnimeProgress.anime_id),
            ).all()
            summary['checked'] = len(anime_ids)
            for anime_id in anime_ids:
                try:
                    anime = session.get(AnimeMetaInfo, anime_id)
                    if anime is None:
                        continue
                    provider = provider_factory.get_provider(anime.provider_type)
                    result = sync_anime_from_provider(session, provider, anime_id=anime_id, user_id=user_id)
                    if result is None:
                        continue
                    poster_ids = result.poster_ids_to_enqueue
                    conflict_count = len(result.episode_conflicts)
                    session.commit()
                except Exception:
                    session.rollback()
                    summary['failed'] += 1
                    logger.warning('Failed to sync user %s anime %s', user_id, anime_id, exc_info=True)
                    continue
                for poster_id in poster_ids:
                    _enqueue_poster_download(database_url, poster_id)
                summary['synced'] += 1
                summary['episodeConflicts'] += conflict_count
                summary['postersQueued'] += len(poster_ids)
    finally:
        engine.dispose()
    return summary


@celery_app.task(name='app.tasks.anime_sync.refresh_user_library')
def refresh_user_library(user_id: int, lock_path: str | None = None, job_dir: str | None = None, job_id: str | None = None) -> dict[str, object]:
    try:
        _update_refresh_job(job_dir, job_id, status='running', progress=_refresh_progress('syncing', 0, 2, 'Refreshing library metadata'))
        sync_summary = sync_user_library_anime(user_id)
        discovery_summary = None
        if env_bool('AUTO_IMPORT_TVDB_SEASONS_ENABLED'):
            from app.tasks.tvdb_season_discovery import discover_tvdb_seasons_for_user

            _update_refresh_job(job_dir, job_id, progress=_refresh_progress('discovering_tvdb_seasons', 1, 2, 'Checking TVDB seasons'))
            discovery_summary = discover_tvdb_seasons_for_user(user_id)
        else:
            _update_refresh_job(job_dir, job_id, progress=_refresh_progress('discovering_tvdb_seasons', 1, 2, 'TVDB season discovery is disabled'))
        summary = {'sync': sync_summary, 'tvdbSeasonDiscovery': discovery_summary}
        _update_refresh_job(
            job_dir,
            job_id,
            status='completed',
            progress=_refresh_progress('completed', 2, 2, 'Library refresh completed'),
            summary=summary,
        )
        return summary
    except Exception as exc:
        _update_refresh_job(
            job_dir,
            job_id,
            status='failed',
            progress=_refresh_progress('failed', 0, 1, str(exc)),
            summary={'error': type(exc).__name__, 'message': str(exc)},
        )
        raise
    finally:
        release_library_refresh_lock(lock_path)


def _refresh_progress(stage: str, processed: int, total: int, message: str) -> dict[str, object]:
    percent = round(processed / total * 100) if total > 0 else 0
    return {'stage': stage, 'processed': processed, 'total': total, 'percent': percent, 'message': message}


def _update_refresh_job(job_dir: str | None, job_id: str | None, **fields: object) -> None:
    if not job_dir or not job_id:
        return
    update_library_refresh_job(job_dir, job_id, **fields)


def _airing_anime_ids(session) -> list[int]:  # type: ignore[no-untyped-def]
    episode_count = func.count(Episode.id)
    has_upcoming = func.max(func.coalesce(Episode.status == EpisodeStatus.UPCOMING, False))
    rows = session.execute(
        select(AnimeMetaInfo.id)
        .outerjoin(Episode, Episode.anime_id == AnimeMetaInfo.id)
        .group_by(AnimeMetaInfo.id)
        .having(
            or_(
                AnimeMetaInfo.total_episodes.is_(None),
                episode_count < AnimeMetaInfo.total_episodes,
                has_upcoming.is_(True),
            ),
        ),
    ).all()
    return [row.id for row in rows]


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


def _enqueue_poster_download(database_url: str, poster_id: int) -> None:
    storage_dir = str(
        celery_app.conf.get('anime_poster_storage_dir')
        # TODO: Deprecate ANIME_POSTER_STORAGE_DIR and use ANIME_TRACKER_INSTANCE_PATH/anime_posters only.
        or os.environ.get('ANIME_POSTER_STORAGE_DIR')
        or configured_instance_path() / 'anime_posters',
    )
    max_bytes = safe_int(
        celery_app.conf.get('anime_poster_max_bytes') or os.environ.get('ANIME_POSTER_MAX_BYTES'),
        default=5 * 1024 * 1024,
        minimum=1,
    )
    timeout = safe_float(
        celery_app.conf.get('anime_poster_request_timeout') or os.environ.get('ANIME_POSTER_REQUEST_TIMEOUT'),
        default=5,
        minimum=0,
    )
    download_anime_poster.delay(poster_id, database_url, storage_dir, max_bytes, timeout)
