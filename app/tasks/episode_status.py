from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.services.episode_status import refresh_effective_episode_statuses


@celery_app.task(
    name='app.tasks.episode_status.refresh_effective_episode_statuses',
    ignore_result=True,
)
def refresh_effective_episode_statuses_task() -> None:
    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    try:
        with sessionmaker(bind=engine)() as session:
            refresh_effective_episode_statuses(session)
            session.commit()
    finally:
        engine.dispose()
