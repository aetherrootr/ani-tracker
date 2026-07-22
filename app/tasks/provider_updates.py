from __future__ import annotations

import logging
import os
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.import_provider import ImportProviderFactory
from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import ImportProviderNotFoundError, ImportProviderResponseError
from app.import_provider.tvdb import TVDBImportProvider
from app.import_provider.tvdb.utils import build_external_id, coerce_int, parse_external_id
from app.import_provider.types import ImportProviderUpdate, ProviderUpdateMethod
from app.models.anime import AnimeMetaInfo, Episode, EpisodeStatus
from app.models.provider_sync import ProviderSyncCursor
from app.services.anime_sync import sync_anime_from_provider
from app.tasks.anime_sync import _enqueue_poster_download, _provider_config
from app.utils import safe_int

logger = logging.getLogger(__name__)


@celery_app.task(
    name='app.tasks.provider_updates.poll_provider_updates',
    autoretry_for=(Exception,),
    retry_backoff=30,
    retry_backoff_max=10 * 60,
    retry_jitter=True,
    retry_kwargs={'max_retries': 5},
    ignore_result=True,
)
def poll_provider_updates() -> None:
    database_url = str(celery_app.conf.get('database_url') or os.environ.get('DATABASE_URL') or default_database_url())
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    providers = [provider for provider in ImportProviderFactory.from_config(_provider_config()).list_providers() if provider.supports_updates]
    errors: list[Exception] = []
    try:
        for provider in providers:
            for stream in provider.update_streams:
                try:
                    _poll_stream(session_factory, provider, database_url=database_url, stream=stream)
                except Exception as exc:
                    errors.append(exc)
                    logger.warning('Failed to poll %s updates stream %s', provider.name, stream, exc_info=True)
    finally:
        engine.dispose()
    if errors:
        raise errors[0]


def _poll_stream(session_factory, provider, *, database_url: str, stream: str) -> None:  # type: ignore[no-untyped-def]
    now = datetime.now(UTC)
    owner = uuid.uuid4().hex
    lookback = safe_int(os.environ.get('PROVIDER_UPDATES_INITIAL_LOOKBACK_SECONDS'), default=3600, minimum=60)
    overlap = safe_int(os.environ.get('PROVIDER_UPDATES_OVERLAP_SECONDS'), default=600, minimum=0)
    lease_seconds = safe_int(os.environ.get('PROVIDER_UPDATES_LEASE_SECONDS'), default=600, minimum=60)
    safety_lag = safe_int(os.environ.get('PROVIDER_UPDATES_SAFETY_LAG_SECONDS'), default=60, minimum=0)
    max_pages = safe_int(os.environ.get('PROVIDER_UPDATES_MAX_PAGES'), default=10, minimum=1)
    with session_factory() as session:
        cursor = _acquire_cursor(
            session,
            provider_name=provider.name,
            stream=stream,
            owner=owner,
            now=now,
            initial_cursor=int(now.timestamp()) - lookback,
            lease_seconds=lease_seconds,
        )
        if cursor is None:
            return
        cursor_page = session.scalar(
            select(ProviderSyncCursor.cursor_page).where(
                ProviderSyncCursor.provider == provider.name,
                ProviderSyncCursor.stream == stream,
                ProviderSyncCursor.lease_owner == owner,
            ),
        ) or 0
        since = max(0, cursor - overlap)
    try:
        batch = provider.get_updates(since=since, stream=stream, page=cursor_page, max_pages=max_pages)
        events = batch.updates
        with session_factory() as session:
            if not _renew_cursor_lease(
                session,
                provider_name=provider.name,
                stream=stream,
                owner=owner,
                lease_seconds=lease_seconds,
            ):
                message = f'Lost {provider.name} updates lease for {stream}'
                raise RuntimeError(message)
        with session_factory() as session:
            anime_ids = _affected_anime_ids(session, provider, events, stream=stream)
            if provider.name == 'tvdb' and stream == 'episodes':
                backfill_batch_size = safe_int(
                    os.environ.get('TVDB_STATUS_AIR_TIME_BACKFILL_BATCH_SIZE'),
                    default=10,
                    minimum=1,
                )
                anime_ids = sorted(
                    set(anime_ids) | set(_missing_status_air_time_anime_ids(session, limit=backfill_batch_size)),
                )
        for anime_id in anime_ids:
            with session_factory() as session:
                if not _renew_cursor_lease(session, provider_name=provider.name, stream=stream, owner=owner, lease_seconds=lease_seconds):
                    message = f'Lost {provider.name} updates lease for {stream}'
                    raise RuntimeError(message)
            with session_factory() as session:
                try:
                    result = sync_anime_from_provider(session, provider, anime_id=anime_id)
                except ImportProviderNotFoundError:
                    session.rollback()
                    logger.warning('%s anime %s no longer exists; skipping its update event', provider.name, anime_id)
                    continue
                if result is None:
                    continue
                poster_ids = result.poster_ids_to_enqueue
                session.commit()
            for poster_id in poster_ids:
                _enqueue_poster_download(database_url, poster_id)
        with session_factory() as session:
            _complete_cursor(
                session,
                provider_name=provider.name,
                stream=stream,
                owner=owner,
                cursor=cursor if batch.next_page is not None else max(cursor, int(now.timestamp()) - safety_lag),
                cursor_page=batch.next_page or 0,
            )
    except Exception as exc:
        with session_factory() as session:
            _fail_cursor(session, provider_name=provider.name, stream=stream, owner=owner, error=str(exc))
        raise


def _acquire_cursor(
    session: Session,
    *,
    provider_name: str = 'tvdb',
    stream: str,
    owner: str,
    now: datetime,
    initial_cursor: int,
    lease_seconds: int,
) -> int | None:
    row = session.scalar(
        select(ProviderSyncCursor).where(
            ProviderSyncCursor.provider == provider_name,
            ProviderSyncCursor.stream == stream,
        ),
    )
    if row is None:
        session.add(ProviderSyncCursor(provider=provider_name, stream=stream, cursor_timestamp=initial_cursor))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
    lease_until = now + timedelta(seconds=lease_seconds)
    result = session.execute(
        update(ProviderSyncCursor)
        .where(
            ProviderSyncCursor.provider == provider_name,
            ProviderSyncCursor.stream == stream,
            or_(
                ProviderSyncCursor.lease_until.is_(None),
                ProviderSyncCursor.lease_until <= now,
            ),
        )
        .values(lease_owner=owner, lease_until=lease_until, last_started_at=now, last_error=None),
        execution_options={'synchronize_session': False},
    )
    session.commit()
    if getattr(result, 'rowcount', 0) != 1:
        return None
    return session.scalar(
        select(ProviderSyncCursor.cursor_timestamp).where(
            ProviderSyncCursor.provider == provider_name,
            ProviderSyncCursor.stream == stream,
            ProviderSyncCursor.lease_owner == owner,
        ),
    )


def _complete_cursor(
    session: Session,
    *,
    provider_name: str = 'tvdb',
    stream: str,
    owner: str,
    cursor: int,
    cursor_page: int = 0,
) -> None:
    session.execute(
        update(ProviderSyncCursor)
        .where(
            ProviderSyncCursor.provider == provider_name,
            ProviderSyncCursor.stream == stream,
            ProviderSyncCursor.lease_owner == owner,
        )
        .values(
            cursor_timestamp=cursor,
            cursor_page=cursor_page,
            lease_owner=None,
            lease_until=None,
            last_succeeded_at=datetime.now(UTC),
            last_error=None,
        ),
        execution_options={'synchronize_session': False},
    )
    session.commit()


def _renew_cursor_lease(session: Session, *, provider_name: str, stream: str, owner: str, lease_seconds: int) -> bool:
    result = session.execute(
        update(ProviderSyncCursor)
        .where(
            ProviderSyncCursor.provider == provider_name,
            ProviderSyncCursor.stream == stream,
            ProviderSyncCursor.lease_owner == owner,
        )
        .values(lease_until=datetime.now(UTC) + timedelta(seconds=lease_seconds)),
        execution_options={'synchronize_session': False},
    )
    session.commit()
    return getattr(result, 'rowcount', 0) == 1


def _fail_cursor(session: Session, *, provider_name: str, stream: str, owner: str, error: str) -> None:
    session.execute(
        update(ProviderSyncCursor)
        .where(
            ProviderSyncCursor.provider == provider_name,
            ProviderSyncCursor.stream == stream,
            ProviderSyncCursor.lease_owner == owner,
        )
        .values(lease_owner=None, lease_until=None, last_error=error[:1024]),
        execution_options={'synchronize_session': False},
    )
    session.commit()


def _affected_anime_ids(
    session: Session,
    provider: ImportProvider,
    events: list[ImportProviderUpdate],
    *,
    stream: str,
) -> list[int]:
    provider_anime = session.scalars(select(AnimeMetaInfo).where(AnimeMetaInfo.provider_type == provider.name)).all()
    if not isinstance(provider, TVDBImportProvider):
        generic_anime_ids_by_external_id = {anime.external_id: anime.id for anime in provider_anime}
        generic_episode_anime_ids = {
            external_id: anime_id
            for external_id, anime_id in session.execute(
                select(Episode.provider_external_id, Episode.anime_id)
                .join(AnimeMetaInfo, AnimeMetaInfo.id == Episode.anime_id)
                .where(
                    AnimeMetaInfo.provider_type == provider.name,
                    Episode.provider_external_id.is_not(None),
                ),
            )
            if external_id is not None
        }
        generic_affected_ids = {
            anime_id
            for event in events
            for external_id in event.affected_external_ids
            if (anime_id := generic_anime_ids_by_external_id.get(external_id)) is not None
        }
        generic_affected_ids.update(
            anime_id
            for event in events
            if (anime_id := generic_episode_anime_ids.get(str(event.record_id))) is not None
        )
        return sorted(generic_affected_ids)
    by_series: dict[str, list[AnimeMetaInfo]] = {}
    by_external_id: dict[str, AnimeMetaInfo] = {}
    for tvdb_item in provider_anime:
        try:
            parsed_series_id, parsed_season_number = parse_external_id(tvdb_item.external_id)
        except ImportProviderResponseError:
            logger.warning('Ignoring invalid TVDB external id %s', tvdb_item.external_id)
            continue
        by_series.setdefault(str(parsed_series_id), []).append(tvdb_item)
        by_external_id[build_external_id(parsed_series_id, parsed_season_number)] = tvdb_item
    affected: set[int] = set()
    if stream == 'series':
        for event in events:
            affected.update(anime.id for anime in by_series.get(str(event.record_id), []))
        return sorted(affected)
    episode_anime = {
        external_id: anime_id
        for external_id, anime_id in session.execute(
            select(Episode.provider_external_id, Episode.anime_id)
            .join(AnimeMetaInfo, AnimeMetaInfo.id == Episode.anime_id)
            .where(
                AnimeMetaInfo.provider_type == 'tvdb',
                Episode.provider_external_id.is_not(None),
            ),
        )
        if external_id is not None
    }
    for event in events:
        existing_anime_id = episode_anime.get(str(event.record_id))
        if existing_anime_id is not None:
            affected.add(existing_anime_id)
            continue
        episode = None
        episode_record_id = coerce_int(event.record_id)
        event_series_id = str(event.parent_id) if event.parent_id is not None else None
        if event_series_id is None and event.method != ProviderUpdateMethod.DELETE and episode_record_id is not None:
            episode = provider.get_episode_base(episode_record_id)
            episode_series_id = coerce_int(episode.get('seriesId')) if episode is not None else None
            event_series_id = str(episode_series_id) if episode_series_id is not None else None
        if event_series_id is None or event_series_id not in by_series:
            continue
        if episode is None and event.method != ProviderUpdateMethod.DELETE and episode_record_id is not None:
            episode = provider.get_episode_base(episode_record_id)
        event_season_number = coerce_int(episode.get('seasonNumber')) if episode is not None else None
        if event_season_number is None:
            affected.update(anime.id for anime in by_series[event_series_id])
            continue
        matched_anime = by_external_id.get(build_external_id(event_series_id, event_season_number))
        if matched_anime is not None:
            affected.add(matched_anime.id)
    return sorted(affected)


def _missing_status_air_time_anime_ids(session: Session, *, limit: int) -> list[int]:
    return list(
        session.scalars(
            select(AnimeMetaInfo.id)
            .join(Episode, Episode.anime_id == AnimeMetaInfo.id)
            .where(
                AnimeMetaInfo.provider_type == 'tvdb',
                Episode.status == EpisodeStatus.UPCOMING,
                Episode.air_at.is_not(None),
                Episode.status_air_at.is_(None),
            )
            .group_by(AnimeMetaInfo.id)
            .order_by(AnimeMetaInfo.last_synced_at.asc().nulls_first(), AnimeMetaInfo.id)
            .limit(limit),
        ).all(),
    )
