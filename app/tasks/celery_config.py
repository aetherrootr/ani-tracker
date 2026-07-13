from __future__ import annotations

import os
import secrets

from celery.schedules import crontab

from app.celery_app import celery_app
from app.utils import env_bool, local_timezone, safe_cron_months, safe_int


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
            os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_MONTHS'),
            os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_DAY'),
            os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_HOUR'),
            os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_MINUTE'),
            tvdb_season_discovery_enabled=env_bool('AUTO_IMPORT_TVDB_SEASONS_ENABLED'),
            tvdb_season_discovery_day=os.environ.get('AUTO_IMPORT_TVDB_SEASONS_CRON_DAY'),
            tvdb_season_discovery_hour=os.environ.get('AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR'),
            tvdb_season_discovery_minute=os.environ.get('AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE'),
            bangumi_related_anime_discovery_enabled=env_bool('AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED'),
            bangumi_related_anime_discovery_day=os.environ.get('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY'),
            bangumi_related_anime_discovery_hour=os.environ.get('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR'),
            bangumi_related_anime_discovery_minute=os.environ.get('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE'),
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
            config.get('UNTRACKED_ANIME_CLEANUP_CRON_MONTHS'),
            config.get('UNTRACKED_ANIME_CLEANUP_CRON_DAY'),
            config.get('UNTRACKED_ANIME_CLEANUP_CRON_HOUR'),
            config.get('UNTRACKED_ANIME_CLEANUP_CRON_MINUTE'),
            tvdb_season_discovery_enabled=bool(config.get('AUTO_IMPORT_TVDB_SEASONS_ENABLED')),
            tvdb_season_discovery_day=config.get('AUTO_IMPORT_TVDB_SEASONS_CRON_DAY'),
            tvdb_season_discovery_hour=config.get('AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR'),
            tvdb_season_discovery_minute=config.get('AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE'),
            bangumi_related_anime_discovery_enabled=bool(config.get('AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED')),
            bangumi_related_anime_discovery_day=config.get('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY'),
            bangumi_related_anime_discovery_hour=config.get('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR'),
            bangumi_related_anime_discovery_minute=config.get('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE'),
        ),
    )


def _beat_schedule(
    hour: object,
    minute: object,
    cleanup_months: object = None,
    cleanup_day: object = None,
    cleanup_hour: object = None,
    cleanup_minute: object = None,
    *,
    tvdb_season_discovery_enabled: bool = False,
    tvdb_season_discovery_day: object = None,
    tvdb_season_discovery_hour: object = None,
    tvdb_season_discovery_minute: object = None,
    bangumi_related_anime_discovery_enabled: bool = False,
    bangumi_related_anime_discovery_day: object = None,
    bangumi_related_anime_discovery_hour: object = None,
    bangumi_related_anime_discovery_minute: object = None,
) -> dict[str, object]:
    schedule: dict[str, object] = {
        'sync-airing-anime': {
            'task': 'app.tasks.anime_sync.sync_airing_anime',
            'schedule': crontab(
                hour=safe_int(hour, default=4, minimum=0, maximum=23),
                minute=safe_int(minute, default=0, minimum=0, maximum=59),
            ),
        },
        'delete-untracked-anime': {
            'task': 'app.tasks.anime_cleanup.delete_untracked_anime',
            'schedule': crontab(
                month_of_year=safe_cron_months(cleanup_months),
                day_of_month=safe_int(cleanup_day, default=secrets.randbelow(28) + 1, minimum=1, maximum=28),
                hour=safe_int(cleanup_hour, default=secrets.randbelow(24), minimum=0, maximum=23),
                minute=safe_int(cleanup_minute, default=secrets.randbelow(60), minimum=0, maximum=59),
            ),
        },
    }
    if tvdb_season_discovery_enabled:
        schedule['discover-tvdb-seasons'] = {
            'task': 'app.tasks.tvdb_season_discovery.discover_tvdb_seasons_for_all_users',
            'schedule': crontab(
                day_of_month=safe_int(tvdb_season_discovery_day, default=_random_cron_day(), minimum=1, maximum=28),
                hour=safe_int(tvdb_season_discovery_hour, default=_random_cron_hour(1, 3), minimum=0, maximum=23),
                minute=safe_int(tvdb_season_discovery_minute, default=_random_cron_minute(), minimum=0, maximum=59),
            ),
        }
    if bangumi_related_anime_discovery_enabled:
        schedule['discover-bangumi-related-anime'] = {
            'task': 'app.tasks.bangumi_related_anime_discovery.discover_bangumi_related_anime_for_all_users',
            'schedule': crontab(
                day_of_month=safe_int(bangumi_related_anime_discovery_day, default=_random_cron_day(), minimum=1, maximum=28),
                hour=safe_int(bangumi_related_anime_discovery_hour, default=_random_cron_hour(3, 5), minimum=0, maximum=23),
                minute=safe_int(bangumi_related_anime_discovery_minute, default=_random_cron_minute(), minimum=0, maximum=59),
            ),
        }
    return schedule


def _random_cron_day() -> int:
    return secrets.randbelow(28) + 1


def _random_cron_hour(start: int, end: int) -> int:
    return secrets.randbelow(end - start + 1) + start


def _random_cron_minute() -> int:
    return secrets.randbelow(60)


configure_celery_from_env()
