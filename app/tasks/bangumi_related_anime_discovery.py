from __future__ import annotations

import logging
import os

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.import_provider import ImportProviderFactory
from app.models.anime import AnimeMetaInfo, AnimeRelation
from app.models.progress import UserAnimeProgress
from app.services.related_anime_discovery import discover_related_anime_for_user_anime
from app.tasks.anime_sync import _provider_config
from app.tasks.progress import ProgressCallback
from app.tasks.tvdb_season_discovery import _enqueue_poster_download
from app.utils import env_bool

logger = logging.getLogger(__name__)


@celery_app.task(
    name='app.tasks.bangumi_related_anime_discovery.discover_bangumi_related_anime_for_all_users',
    autoretry_for=(Exception,),
    retry_kwargs={'countdown': 5 * 60, 'max_retries': 3},
)
def discover_bangumi_related_anime_for_all_users() -> dict[str, int]:
    if not env_bool('AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED'):
        return {'checked': 0, 'imported': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'postersQueued': 0}

    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    provider = ImportProviderFactory.from_config(_provider_config()).get_provider('bangumi')
    summary = {'checked': 0, 'imported': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'postersQueued': 0}
    try:
        with session_factory() as session:
            rows = session.execute(
                select(UserAnimeProgress.user_id, UserAnimeProgress.anime_id)
                .join(UserAnimeProgress.anime)
                .where(AnimeMetaInfo.provider_type == 'bangumi', UserAnimeProgress.anime_id.not_in(_matched_related_anime_ids('bangumi')))
                .order_by(UserAnimeProgress.user_id, UserAnimeProgress.anime_id),
            ).all()
            summary['checked'] = len(rows)
            for user_id, anime_id in rows:
                try:
                    result = discover_related_anime_for_user_anime(
                        session,
                        provider,
                        user_id=user_id,
                        anime_id=anime_id,
                        provider_name='bangumi',
                        enqueue_posters=False,
                    )
                except Exception:
                    session.rollback()
                    summary['failed'] += 1
                    logger.warning('Failed to discover Bangumi related anime for user %s anime %s', user_id, anime_id, exc_info=True)
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


@celery_app.task(name='app.tasks.bangumi_related_anime_discovery.discover_bangumi_related_anime_for_user')
def discover_bangumi_related_anime_for_user(user_id: int, progress_callback: ProgressCallback | None = None) -> dict[str, int]:
    if not env_bool('AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED'):
        return {'checked': 0, 'imported': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'postersQueued': 0}

    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    provider = ImportProviderFactory.from_config(_provider_config()).get_provider('bangumi')
    summary = {'checked': 0, 'imported': 0, 'existing': 0, 'skipped': 0, 'failed': 0, 'postersQueued': 0}
    try:
        with session_factory() as session:
            rows = session.execute(
                select(UserAnimeProgress.anime_id, AnimeMetaInfo.original_name)
                .join(UserAnimeProgress.anime)
                .where(
                    UserAnimeProgress.user_id == user_id,
                    AnimeMetaInfo.provider_type == 'bangumi',
                    UserAnimeProgress.anime_id.not_in(_matched_related_anime_ids('bangumi')),
                )
                .order_by(UserAnimeProgress.anime_id),
            ).all()
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
                        provider_name='bangumi',
                        enqueue_posters=False,
                    )
                except Exception:
                    session.rollback()
                    summary['failed'] += 1
                    logger.warning('Failed to discover Bangumi related anime for user %s anime %s', user_id, anime_id, exc_info=True)
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


def _matched_related_anime_ids(provider_name: str):  # type: ignore[no-untyped-def]
    return select(AnimeRelation.related_anime_id).where(
        AnimeRelation.provider_type == provider_name,
        AnimeRelation.relation_type == 'same_series_season',
        AnimeRelation.related_anime_id.is_not(None),
    )


def _discovery_progress_details(summary: dict[str, int], *, anime_id: int, anime_title: str | None, processed: int, total: int) -> dict[str, object]:
    return {
        'processed': processed,
        'total': total,
        'currentAnime': {'animeId': anime_id, 'title': anime_title or f'#{anime_id}'},
        'checked': summary['checked'],
        'imported': summary['imported'],
        'existing': summary['existing'],
        'skipped': summary['skipped'],
        'failed': summary['failed'],
        'postersQueued': summary['postersQueued'],
    }
