from __future__ import annotations

from celery import Celery

celery_app = Celery(
    'ani_tracker',
    include=[
        'app.tasks.celery_config',
        'app.tasks.anime_cleanup',
        'app.tasks.anime_poster',
        'app.tasks.anime_sync',
        'app.tasks.tvdb_season_discovery',
        'app.tasks.tvtime_import',
    ],
)
