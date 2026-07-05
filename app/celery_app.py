from __future__ import annotations

from celery import Celery

celery_app = Celery('ani_tracker')


def configure_celery(config: dict[str, object]) -> None:
    celery_app.conf.update(
        broker_url=config.get('CELERY_BROKER_URL', 'memory://'),
        result_backend=config.get('CELERY_RESULT_BACKEND'),
        task_always_eager=bool(config.get('CELERY_TASK_ALWAYS_EAGER')),
    )
