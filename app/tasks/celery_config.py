from __future__ import annotations

import os

from celery.schedules import crontab

from app.celery_app import celery_app
from app.utils import env_bool, local_timezone, safe_int


def configure_celery_from_env() -> None:
    celery_app.conf.update(
        broker_url=os.environ.get('CELERY_BROKER_URL', 'memory://'),
        result_backend=os.environ.get('CELERY_RESULT_BACKEND') or None,
        task_always_eager=env_bool('CELERY_TASK_ALWAYS_EAGER'),
        timezone=local_timezone(os.environ.get('ANIME_SYNC_TIMEZONE')),
        enable_utc=False,
        beat_schedule=_beat_schedule(
            os.environ.get('ANIME_SYNC_CRON_HOUR', '4'),
            os.environ.get('ANIME_SYNC_CRON_MINUTE', '0'),
        ),
    )


def configure_celery(config: dict[str, object]) -> None:
    celery_app.conf.update(
        broker_url=config.get('CELERY_BROKER_URL', 'memory://'),
        result_backend=config.get('CELERY_RESULT_BACKEND'),
        task_always_eager=bool(config.get('CELERY_TASK_ALWAYS_EAGER')),
        database_url=config.get('DATABASE_URL'),
        anime_poster_storage_dir=config.get('ANIME_POSTER_STORAGE_DIR'),
        anime_poster_max_bytes=config.get('ANIME_POSTER_MAX_BYTES'),
        anime_poster_request_timeout=config.get('ANIME_POSTER_REQUEST_TIMEOUT'),
        timezone=local_timezone(config.get('ANIME_SYNC_TIMEZONE')),
        enable_utc=False,
        beat_schedule=_beat_schedule(
            config.get('ANIME_SYNC_CRON_HOUR', 4),
            config.get('ANIME_SYNC_CRON_MINUTE', 0),
        ),
    )


def _beat_schedule(hour: object, minute: object) -> dict[str, object]:
    return {
        'sync-airing-anime': {
            'task': 'app.tasks.anime_sync.sync_airing_anime',
            'schedule': crontab(
                hour=safe_int(hour, default=4, minimum=0, maximum=23),
                minute=safe_int(minute, default=0, minimum=0, maximum=59),
            ),
        },
    }


configure_celery_from_env()
