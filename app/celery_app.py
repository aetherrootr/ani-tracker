from __future__ import annotations

import os

from celery import Celery

celery_app = Celery('ani_tracker', include=['app.tasks.anime_poster'])


def _env_bool(name: str, *, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {'1', 'true', 'yes', 'on'}


celery_app.conf.update(
    broker_url=os.environ.get('CELERY_BROKER_URL', 'memory://'),
    result_backend=os.environ.get('CELERY_RESULT_BACKEND') or None,
    task_always_eager=_env_bool('CELERY_TASK_ALWAYS_EAGER'),
)

import app.tasks.anime_poster  # noqa: E402, F401


def configure_celery(config: dict[str, object]) -> None:
    celery_app.conf.update(
        broker_url=config.get('CELERY_BROKER_URL', 'memory://'),
        result_backend=config.get('CELERY_RESULT_BACKEND'),
        task_always_eager=bool(config.get('CELERY_TASK_ALWAYS_EAGER')),
    )
