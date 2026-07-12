from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.services.anime_cleanup import delete_untracked_anime
from app.utils import configured_instance_path


@celery_app.task(
    name='app.tasks.anime_cleanup.delete_untracked_anime',
    autoretry_for=(Exception,),
    retry_kwargs={'countdown': 5 * 60, 'max_retries': 3},
)
def delete_untracked_anime_task() -> dict[str, int]:
    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    storage_dir = str(
        celery_app.conf.get('anime_poster_storage_dir')
        # TODO(aetherrootr): Deprecate ANIME_POSTER_STORAGE_DIR and use ANIME_TRACKER_INSTANCE_PATH/anime_posters only.
        or os.environ.get('ANIME_POSTER_STORAGE_DIR')
        or configured_instance_path() / 'anime_posters',
    )
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    with session_factory() as session:
        return delete_untracked_anime(session, poster_storage_dir=storage_dir)
