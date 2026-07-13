from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.import_provider import ImportProviderFactory
from app.models.anime import AnimeMetaInfo
from app.services.library_refresh_jobs import update_library_refresh_job
from app.services.related_anime_discovery import discover_related_anime_for_user_anime
from app.tasks.anime_sync import _enqueue_poster_download, _provider_config


@celery_app.task(name='app.tasks.related_anime_discovery.discover_related_anime_for_library_anime')
def discover_related_anime_for_library_anime(user_id: int, anime_id: int, job_dir: str, job_id: str) -> dict[str, object]:
    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        update_library_refresh_job(job_dir, job_id, status='running', progress=_progress('discovering_related_anime', 0, 1, 'Checking related anime'))
        with session_factory() as session:
            anime = session.get(AnimeMetaInfo, anime_id)
            if anime is None:
                summary: dict[str, object] = {'error': 'not_found'}
                update_library_refresh_job(job_dir, job_id, status='failed', progress=_progress('failed', 0, 1, 'Anime not found'), summary=summary)
                return summary
            provider = ImportProviderFactory.from_config(_provider_config()).get_provider(anime.provider_type)
            result = discover_related_anime_for_user_anime(
                session,
                provider,
                user_id=user_id,
                anime_id=anime_id,
                provider_name=anime.provider_type,
                enqueue_posters=False,
            )
            summary = {
                'checked': result.checked,
                'skippedReason': result.skipped_reason,
                'importedAnimeIds': result.imported_anime_ids,
                'existingAnimeIds': result.existing_anime_ids,
                'postersQueued': len(set(result.poster_ids_to_enqueue)),
            }
            update_library_refresh_job(job_dir, job_id, status='completed', progress=_progress('completed', 1, 1, 'Related anime discovery completed'), summary=summary)
            for poster_id in dict.fromkeys(result.poster_ids_to_enqueue):
                _enqueue_poster_download(database_url, poster_id)
            return summary
    except Exception as exc:
        summary = {'error': type(exc).__name__, 'message': str(exc)}
        update_library_refresh_job(job_dir, job_id, status='failed', progress=_progress('failed', 0, 1, str(exc)), summary=summary)
        raise
    finally:
        engine.dispose()


def _progress(stage: str, processed: int, total: int, message: str) -> dict[str, object]:
    percent = round(processed / total * 100) if total > 0 else 0
    return {'stage': stage, 'processed': processed, 'total': total, 'percent': percent, 'message': message}
