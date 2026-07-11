from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.db import ensure_database_current
from app.services.anime_poster import download_poster_to_storage


@celery_app.task(name='app.tasks.anime_poster.download_anime_poster')
def download_anime_poster(
    poster_id: int,
    database_url: str,
    storage_dir: str,
    max_bytes: int,
    timeout: float,
) -> None:
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    with session_factory() as session:
        download_poster_to_storage(
            session,
            poster_id=poster_id,
            storage_dir=storage_dir,
            max_bytes=max_bytes,
            timeout=timeout,
        )
