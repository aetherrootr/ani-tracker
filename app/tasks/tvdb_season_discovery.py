from __future__ import annotations

import logging
import os

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.import_provider import ImportProviderFactory
from app.import_provider.exceptions import ImportProviderResponseError
from app.import_provider.tvdb.utils import parse_external_id
from app.models.anime import AnimeMetaInfo
from app.models.progress import UserAnimeProgress
from app.services.related_anime_discovery import (
    ELIGIBLE_TVDB_SEASON_STATUSES,
    discover_related_anime_for_user_anime,
)
from app.tasks.anime_sync import _provider_config
from app.tasks.progress import ProgressCallback
from app.utils import env_bool

logger = logging.getLogger(__name__)


@celery_app.task(
    name='app.tasks.tvdb_season_discovery.discover_tvdb_seasons_for_all_users',
    autoretry_for=(Exception,),
    retry_kwargs={'countdown': 5 * 60, 'max_retries': 3},
)
def discover_tvdb_seasons_for_all_users() -> dict[str, int]:
    if not env_bool('AUTO_IMPORT_TVDB_SEASONS_ENABLED'):
        return {'checked': 0, 'imported': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'postersQueued': 0}

    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    provider = ImportProviderFactory.from_config(_provider_config()).get_provider('tvdb')
    summary = {'checked': 0, 'imported': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'postersQueued': 0}
    try:
        with session_factory() as session:
            rows = _tvdb_series_refresh_candidates(
                session.execute(
                    select(
                        UserAnimeProgress.user_id,
                        UserAnimeProgress.anime_id,
                        AnimeMetaInfo.external_id,
                        UserAnimeProgress.status,
                    )
                    .join(UserAnimeProgress.anime)
                    .where(AnimeMetaInfo.provider_type == 'tvdb')
                    .order_by(UserAnimeProgress.user_id, UserAnimeProgress.anime_id),
                ).all(),
            )
            summary['checked'] = len(rows)
            for row in rows:
                user_id = row.user_id
                anime_id = row.anime_id
                try:
                    result = discover_related_anime_for_user_anime(
                        session,
                        provider,
                        user_id=user_id,
                        anime_id=anime_id,
                        provider_name='tvdb',
                        enqueue_posters=False,
                    )
                except Exception:
                    session.rollback()
                    summary['failed'] += 1
                    logger.warning('Failed to discover TVDB seasons for user %s anime %s', user_id, anime_id, exc_info=True)
                    continue
                if result.skipped_reason is not None:
                    summary['skipped'] += 1
                summary['imported'] += len(result.imported_anime_ids)
                summary['existing'] += len(result.existing_anime_ids)
                summary['postersQueued'] += len(set(result.poster_ids_to_enqueue))
                for poster_id in dict.fromkeys(result.poster_ids_to_enqueue):
                    _enqueue_poster_download(database_url, poster_id)
    finally:
        engine.dispose()
    return summary


@celery_app.task(name='app.tasks.tvdb_season_discovery.discover_tvdb_seasons_for_user')
def discover_tvdb_seasons_for_user(user_id: int, progress_callback: ProgressCallback | None = None) -> dict[str, int]:
    if not env_bool('AUTO_IMPORT_TVDB_SEASONS_ENABLED'):
        return {'checked': 0, 'imported': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'postersQueued': 0}

    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    provider = ImportProviderFactory.from_config(_provider_config()).get_provider('tvdb')
    summary = {'checked': 0, 'imported': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'postersQueued': 0}
    try:
        with session_factory() as session:
            rows = _tvdb_series_refresh_candidates(
                session.execute(
                    select(
                        UserAnimeProgress.user_id,
                        UserAnimeProgress.anime_id,
                        AnimeMetaInfo.external_id,
                        UserAnimeProgress.status,
                        AnimeMetaInfo.original_name,
                    )
                    .join(UserAnimeProgress.anime)
                    .where(
                        UserAnimeProgress.user_id == user_id,
                        AnimeMetaInfo.provider_type == 'tvdb',
                    )
                    .order_by(UserAnimeProgress.anime_id),
                ).all(),
            )
            summary['checked'] = len(rows)
            for index, row in enumerate(rows, start=1):
                anime_id = row.anime_id
                anime_title = row.original_name
                if progress_callback is not None:
                    progress_callback(_discovery_progress_details(summary, anime_id=anime_id, anime_title=anime_title, processed=index - 1, total=len(rows)))
                try:
                    result = discover_related_anime_for_user_anime(
                        session,
                        provider,
                        user_id=user_id,
                        anime_id=anime_id,
                        provider_name='tvdb',
                        enqueue_posters=False,
                    )
                except Exception:
                    session.rollback()
                    summary['failed'] += 1
                    logger.warning('Failed to discover TVDB seasons for user %s anime %s', user_id, anime_id, exc_info=True)
                    if progress_callback is not None:
                        progress_callback(_discovery_progress_details(summary, anime_id=anime_id, anime_title=anime_title, processed=index, total=len(rows)))
                    continue
                if result.skipped_reason is not None:
                    summary['skipped'] += 1
                summary['imported'] += len(result.imported_anime_ids)
                summary['existing'] += len(result.existing_anime_ids)
                summary['postersQueued'] += len(set(result.poster_ids_to_enqueue))
                for poster_id in dict.fromkeys(result.poster_ids_to_enqueue):
                    _enqueue_poster_download(database_url, poster_id)
                if progress_callback is not None:
                    progress_callback(_discovery_progress_details(summary, anime_id=anime_id, anime_title=anime_title, processed=index, total=len(rows)))
    finally:
        engine.dispose()
    return summary


def _tvdb_series_refresh_candidates(rows):  # type: ignore[no-untyped-def]
    candidates_by_series: dict[tuple[int, str], object] = {}
    for row in rows:
        try:
            series_id, _season_number = parse_external_id(row.external_id)
        except ImportProviderResponseError:
            continue
        key = (row.user_id, series_id)
        existing = candidates_by_series.get(key)
        if existing is None or (existing.status not in ELIGIBLE_TVDB_SEASON_STATUSES and row.status in ELIGIBLE_TVDB_SEASON_STATUSES):
            candidates_by_series[key] = row
    return list(candidates_by_series.values())


def _discovery_progress_details(summary: dict[str, int], *, anime_id: int, anime_title: str | None, processed: int, total: int) -> dict[str, object]:
    return {
        'processed': processed,
        'total': total,
        'currentAnime': {'animeId': anime_id, 'title': anime_title or f'#{anime_id}'},
        'checked': summary['checked'],
        'imported': summary['imported'],
        'existing': summary.get('existing', 0),
        'skipped': summary['skipped'],
        'failed': summary['failed'],
        'postersQueued': summary['postersQueued'],
    }


def _enqueue_poster_download(database_url: str, poster_id: int) -> None:
    from app.tasks.anime_sync import _enqueue_poster_download as enqueue

    enqueue(database_url, poster_id)
