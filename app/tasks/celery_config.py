from __future__ import annotations

import os
import secrets

from celery.schedules import crontab

from app.celery_app import celery_app
from app.utils import env_bool, local_timezone, safe_cron_hours, safe_cron_months, safe_int


def configure_celery_from_env() -> None:
    celery_app.conf.update(
        broker_url=os.environ.get('CELERY_BROKER_URL', 'memory://'),
        result_backend=os.environ.get('CELERY_RESULT_BACKEND') or None,
        task_always_eager=env_bool('CELERY_TASK_ALWAYS_EAGER'),
        provider_updates_enabled=env_bool('PROVIDER_UPDATES_ENABLED', default=True),
        timezone=local_timezone(os.environ.get('ANIME_SYNC_TIMEZONE')),
        enable_utc=False,
        beat_schedule=_beat_schedule(
            os.environ.get('ANIME_SYNC_CRON_HOUR', '4'),
            os.environ.get('ANIME_SYNC_CRON_MINUTE', '0'),
            os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_MONTHS'),
            os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_DAY'),
            os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_HOUR'),
            os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_MINUTE'),
            cleanup_disabled=env_bool('UNTRACKED_ANIME_CLEANUP_DISABLED', default=True),
            non_incremental_sync_hours=os.environ.get('NON_INCREMENTAL_ANIME_SYNC_CRON_HOUR', '0,4,8,12,16,20'),
            non_incremental_sync_minute=safe_int(os.environ.get('NON_INCREMENTAL_ANIME_SYNC_CRON_MINUTE'), default=0, minimum=0, maximum=59),
            episode_status_refresh_interval=safe_int(os.environ.get('EPISODE_STATUS_REFRESH_INTERVAL_SECONDS'), default=60, minimum=10),
            provider_updates_enabled=env_bool('PROVIDER_UPDATES_ENABLED', default=True),
            provider_updates_interval=safe_int(os.environ.get('PROVIDER_UPDATES_INTERVAL_SECONDS'), default=900, minimum=60),
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
        provider_updates_enabled=bool(config.get('PROVIDER_UPDATES_ENABLED', True)),
        database_url=config.get('DATABASE_URL'),
        anime_poster_storage_dir=config.get('ANIME_POSTER_STORAGE_DIR'),
        anime_poster_max_bytes=config.get('ANIME_POSTER_MAX_BYTES'),
        anime_poster_request_timeout=config.get('ANIME_POSTER_REQUEST_TIMEOUT'),
        timezone=local_timezone(config.get('ANIME_SYNC_TIMEZONE')),
        enable_utc=False,
        beat_schedule=_beat_schedule(
            config.get('ANIME_SYNC_CRON_HOUR', '4'),
            config.get('ANIME_SYNC_CRON_MINUTE', 0),
            config.get('UNTRACKED_ANIME_CLEANUP_CRON_MONTHS'),
            config.get('UNTRACKED_ANIME_CLEANUP_CRON_DAY'),
            config.get('UNTRACKED_ANIME_CLEANUP_CRON_HOUR'),
            config.get('UNTRACKED_ANIME_CLEANUP_CRON_MINUTE'),
            cleanup_disabled=bool(config.get('UNTRACKED_ANIME_CLEANUP_DISABLED', True)),
            non_incremental_sync_hours=config.get('NON_INCREMENTAL_ANIME_SYNC_CRON_HOUR', '0,4,8,12,16,20'),
            non_incremental_sync_minute=safe_int(config.get('NON_INCREMENTAL_ANIME_SYNC_CRON_MINUTE'), default=0, minimum=0, maximum=59),
            episode_status_refresh_interval=safe_int(config.get('EPISODE_STATUS_REFRESH_INTERVAL_SECONDS'), default=60, minimum=10),
            provider_updates_enabled=bool(config.get('PROVIDER_UPDATES_ENABLED', True)),
            provider_updates_interval=safe_int(config.get('PROVIDER_UPDATES_INTERVAL_SECONDS'), default=900, minimum=60),
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
    cleanup_disabled: bool = False,
    non_incremental_sync_hours: object = '0,4,8,12,16,20',
    non_incremental_sync_minute: int = 0,
    episode_status_refresh_interval: int = 60,
    provider_updates_enabled: bool = True,
    provider_updates_interval: int = 900,
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
        'sync-incremental-provider-airing-anime': {
            'task': 'app.tasks.anime_sync.sync_incremental_provider_airing_anime',
            'schedule': crontab(
                hour=safe_cron_hours(hour),
                minute=safe_int(minute, default=0, minimum=0, maximum=59),
            ),
        },
        'sync-non-incremental-provider-airing-anime': {
            'task': 'app.tasks.anime_sync.sync_non_incremental_provider_airing_anime',
            'schedule': crontab(
                hour=safe_cron_hours(non_incremental_sync_hours, default='0,4,8,12,16,20'),
                minute=non_incremental_sync_minute,
            ),
        },
        'refresh-effective-episode-statuses': {
            'task': 'app.tasks.episode_status.refresh_effective_episode_statuses',
            'schedule': float(episode_status_refresh_interval),
            'options': {'expires': max(1, episode_status_refresh_interval - 5)},
        },
    }
    if not cleanup_disabled:
        schedule['delete-untracked-anime'] = {
            'task': 'app.tasks.anime_cleanup.delete_untracked_anime',
            'schedule': crontab(
                month_of_year=safe_cron_months(cleanup_months),
                day_of_month=safe_int(cleanup_day, default=secrets.randbelow(28) + 1, minimum=1, maximum=28),
                hour=safe_int(cleanup_hour, default=secrets.randbelow(24), minimum=0, maximum=23),
                minute=safe_int(cleanup_minute, default=secrets.randbelow(60), minimum=0, maximum=59),
            ),
        }
    if provider_updates_enabled:
        schedule['poll-provider-updates'] = {
            'task': 'app.tasks.provider_updates.poll_provider_updates',
            'schedule': float(provider_updates_interval),
            'options': {'expires': max(1, provider_updates_interval - 60)},
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
