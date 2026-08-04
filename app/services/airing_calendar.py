from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.utils.serializers import (
    select_anime_name_for_user,
    select_episode_name_for_user,
    select_poster_for_user,
    serialize_poster,
)
from app.models.anime import AnimeMetaInfo, AnimePoster, Episode, EpisodeStatus
from app.models.progress import (
    UserAnimeMetadataEpisodeSnapshot,
    UserAnimeMetadataSnapshot,
    UserAnimeMetadataSource,
    UserAnimeProgress,
    UserAnimeStatus,
    UserEpisodeProgress,
)
from app.models.user import User

CALENDAR_DAY_COUNT = 21
MAX_CALENDAR_EPISODE_DETAILS_PER_ANIME = 50


def get_user_airing_calendar(
    session: Session,
    user: User,
    *,
    start_date: date | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    time_zone = ZoneInfo(user.time_zone)
    generated_at = _aware_utc(now or datetime.now(UTC))
    local_today = generated_at.astimezone(time_zone).date()
    week_start = _start_of_week(local_today, user.week_start_day)
    week_end = week_start + timedelta(days=6)
    window_start = start_date or week_start - timedelta(days=7)
    window_end = window_start + timedelta(days=CALENDAR_DAY_COUNT - 1)

    date_window_start = datetime.combine(window_start, time.min, UTC)
    date_window_end = datetime.combine(window_end + timedelta(days=1), time.min, UTC)
    timed_window_start = datetime.combine(window_start, time.min, time_zone).astimezone(UTC)
    timed_window_end = datetime.combine(window_end + timedelta(days=1), time.min, time_zone).astimezone(UTC)
    upstream_episode_filter = and_(
        Episode.air_at.is_not(None),
        Episode.status.not_in([
            EpisodeStatus.CANCELLED,
            EpisodeStatus.DELAYED,
            EpisodeStatus.UNKNOWN,
        ]),
        or_(
            and_(
                Episode.air_at_has_time.is_(False),
                Episode.air_at >= date_window_start,
                Episode.air_at < date_window_end,
            ),
            and_(
                Episode.air_at_has_time.is_(True),
                Episode.air_at >= timed_window_start,
                Episode.air_at < timed_window_end,
            ),
        ),
    )
    snapshot_episode_filter = and_(
        UserAnimeMetadataEpisodeSnapshot.air_at.is_not(None),
        UserAnimeMetadataEpisodeSnapshot.status.not_in([
            EpisodeStatus.CANCELLED.value,
            EpisodeStatus.DELAYED.value,
            EpisodeStatus.UNKNOWN.value,
        ]),
        or_(
            and_(
                UserAnimeMetadataEpisodeSnapshot.air_at_has_time.is_(False),
                UserAnimeMetadataEpisodeSnapshot.air_at >= date_window_start,
                UserAnimeMetadataEpisodeSnapshot.air_at < date_window_end,
            ),
            and_(
                UserAnimeMetadataEpisodeSnapshot.air_at_has_time.is_(True),
                UserAnimeMetadataEpisodeSnapshot.air_at >= timed_window_start,
                UserAnimeMetadataEpisodeSnapshot.air_at < timed_window_end,
            ),
        ),
    )

    progresses = session.scalars(
        select(UserAnimeProgress)
        .options(
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeProgress.anime)
            .selectinload(AnimeMetaInfo.posters)
            .selectinload(AnimePoster.resource),
            selectinload(UserAnimeProgress.anime)
            .selectinload(AnimeMetaInfo.episodes.and_(upstream_episode_filter))
            .selectinload(Episode.names),
            selectinload(UserAnimeProgress.metadata_snapshot).selectinload(
                UserAnimeMetadataSnapshot.episodes.and_(snapshot_episode_filter),
            ),
        )
        .where(
            UserAnimeProgress.user_id == user.id,
            UserAnimeProgress.status.in_([
                UserAnimeStatus.WATCHING,
                UserAnimeStatus.PLAN_TO_WATCH,
                UserAnimeStatus.COMPLETED,
            ]),
        ).execution_options(populate_existing=True),
    ).all()

    upstream_episode_ids = {
        episode.id
        for progress in progresses
        if not _uses_local_snapshot(progress)
        for episode in progress.anime.episodes
    }
    watched_by_episode_id: dict[int, tuple[bool, int | None]] = {}
    if upstream_episode_ids:
        watch_rows = session.scalars(
            select(UserEpisodeProgress).where(
                UserEpisodeProgress.user_id == user.id,
                UserEpisodeProgress.episode_id.in_(upstream_episode_ids),
            ),
        ).all()
        watched_by_episode_id = {
            row.episode_id: (row.watched, row.preferred_name_id)
            for row in watch_rows
        }

    buckets: dict[date, list[dict[str, Any]]] = {
        window_start + timedelta(days=offset): []
        for offset in range(CALENDAR_DAY_COUNT)
    }
    for progress in progresses:
        if _uses_local_snapshot(progress):
            snapshot = progress.metadata_snapshot
            if snapshot is None:
                continue
            snapshot_episodes = list(snapshot.episodes)
            display_name = snapshot.source_title
            candidates = [
                _candidate_from_snapshot(episode, time_zone, window_start, window_end)
                for episode in snapshot_episodes
            ]
        else:
            upstream_episodes = list(progress.anime.episodes)
            selected_name = select_anime_name_for_user(
                sorted(progress.anime.names, key=lambda item: item.id),
                progress,
                user,
            )
            display_name = selected_name.name if selected_name is not None else progress.anime.original_name
            candidates = [
                _candidate_from_upstream(
                    episode,
                    user,
                    watched_by_episode_id,
                    time_zone,
                    window_start,
                    window_end,
                )
                for episode in upstream_episodes
            ]

        valid_candidates = [candidate for candidate in candidates if candidate is not None]
        if not valid_candidates:
            continue
        poster = select_poster_for_user(
            sorted(progress.anime.posters, key=lambda item: item.id),
            progress,
        )
        serialized_poster = serialize_poster(poster, progress)
        candidates_by_date: dict[date, list[dict[str, Any]]] = {}
        for candidate in valid_candidates:
            candidates_by_date.setdefault(candidate['semantic_date'], []).append(candidate)

        for semantic_date, selected_candidates in candidates_by_date.items():
            selected_candidates.sort(key=_episode_sort_key)
            unique_candidates: list[dict[str, Any]] = []
            seen_episode_ids: set[int] = set()
            for candidate in selected_candidates:
                episode_id = candidate['episode']['id']
                if episode_id in seen_episode_ids:
                    continue
                seen_episode_ids.add(episode_id)
                unique_candidates.append(candidate)

            exact_times = {
                candidate['air_at']
                for candidate in unique_candidates
                if candidate['precision'] == 'datetime'
            }
            minimum_episode = min(unique_candidates, key=lambda candidate: candidate['episode']['id'])
            item = {
                'anime': {
                    'id': progress.anime_id,
                    'displayName': display_name,
                    'originalName': progress.anime.original_name,
                    'posterUrl': serialized_poster['url'] if serialized_poster is not None else None,
                },
                'episodeCount': len(unique_candidates),
                'watchedEpisodeCount': sum(candidate['episode']['watched'] for candidate in unique_candidates),
                'minimumEpisodeTitle': minimum_episode['episode']['displayName'],
                'episodesTruncated': len(unique_candidates) > MAX_CALENDAR_EPISODE_DETAILS_PER_ANIME,
                'scheduleSummary': {
                    'earliestExactAirAt': _iso_utc(min(exact_times)) if exact_times else None,
                    'exactTimeSlotCount': len(exact_times),
                    'hasDatePrecision': any(candidate['precision'] == 'date' for candidate in unique_candidates),
                },
                'episodes': [
                    candidate['episode']
                    for candidate in unique_candidates[:MAX_CALENDAR_EPISODE_DETAILS_PER_ANIME]
                ],
            }
            _require_calendar_invariant(
                condition=semantic_date in buckets,
                message='Invalid airing calendar anime grouping',
            )
            _require_calendar_invariant(
                condition=all(existing['anime']['id'] != progress.anime_id for existing in buckets[semantic_date]),
                message='Duplicate anime in airing calendar day',
            )
            _require_calendar_invariant(
                condition=len(item['episodes']) <= MAX_CALENDAR_EPISODE_DETAILS_PER_ANIME,
                message='Airing calendar episode detail limit exceeded',
            )
            _require_calendar_invariant(
                condition=len({episode['id'] for episode in item['episodes']}) == len(item['episodes']),
                message='Duplicate episode in airing calendar item',
            )
            buckets[semantic_date].append(item)

    days = []
    week_anime_ids: set[int] = set()
    for day, items in buckets.items():
        items.sort(key=_item_sort_key)
        days.append({'date': day.isoformat(), 'items': items})
        if week_start <= day <= week_end:
            week_anime_ids.update(item['anime']['id'] for item in items)

    _require_calendar_invariant(
        condition=len(days) == CALENDAR_DAY_COUNT,
        message='Invalid airing calendar window',
    )
    return {
        'startDate': window_start.isoformat(),
        'endDate': window_end.isoformat(),
        'todayDate': local_today.isoformat(),
        'weekStartDate': week_start.isoformat(),
        'weekEndDate': week_end.isoformat(),
        'timeZone': user.time_zone,
        'generatedAt': _iso_utc(generated_at),
        'totalAnimeCount': len(week_anime_ids),
        'days': days,
    }


def _uses_local_snapshot(progress: UserAnimeProgress) -> bool:
    return (
        progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value
        and progress.metadata_snapshot_id is not None
        and progress.metadata_snapshot is not None
    )


def _candidate_from_upstream(
    episode: Episode,
    user: User,
    watched_by_episode_id: dict[int, tuple[bool, int | None]],
    time_zone: ZoneInfo,
    window_start: date,
    window_end: date,
) -> dict[str, Any] | None:
    watched, preferred_name_id = watched_by_episode_id.get(episode.id, (False, None))
    selected_name = select_episode_name_for_user(
        sorted(episode.names, key=lambda item: item.id),
        user,
        preferred_name_id=preferred_name_id,
    )
    air_at = episode.air_at
    has_time = episode.air_at_has_time
    return _candidate(
        episode_id=episode.id,
        episode_number=episode.episode_number,
        display_name=selected_name.name if selected_name is not None else episode.original_title,
        air_at=air_at,
        has_time=has_time,
        status=episode.status.value,
        watched=watched,
        time_zone=time_zone,
        window_start=window_start,
        window_end=window_end,
    )


def _candidate_from_snapshot(
    episode: Any,
    time_zone: ZoneInfo,
    window_start: date,
    window_end: date,
) -> dict[str, Any] | None:
    return _candidate(
        episode_id=episode.id,
        episode_number=episode.episode_number,
        display_name=episode.title,
        air_at=episode.air_at,
        has_time=episode.air_at_has_time,
        status=episode.status,
        watched=episode.watched,
        time_zone=time_zone,
        window_start=window_start,
        window_end=window_end,
    )


def _candidate(
    *,
    episode_id: int,
    episode_number: int,
    display_name: str | None,
    air_at: datetime | None,
    has_time: bool,
    status: str,
    watched: bool,
    time_zone: ZoneInfo,
    window_start: date,
    window_end: date,
) -> dict[str, Any] | None:
    if air_at is None or status in {
        EpisodeStatus.CANCELLED.value,
        EpisodeStatus.DELAYED.value,
        EpisodeStatus.UNKNOWN.value,
    }:
        return None
    normalized_air_at = _aware_utc(air_at)
    if has_time:
        semantic_date = normalized_air_at.astimezone(time_zone).date()
        precision = 'datetime'
    else:
        semantic_date = air_at.date()
        precision = 'date'
    if semantic_date < window_start or semantic_date > window_end:
        return None
    return {
        'semantic_date': semantic_date,
        'precision': precision,
        'air_at': normalized_air_at,
        'episode': {
            'id': episode_id,
            'episodeNumber': episode_number,
            'displayName': display_name,
            'airAt': _iso_utc(normalized_air_at),
            'airAtPrecision': precision,
            'status': status,
            'watched': watched,
        },
    }


def _episode_sort_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
    return (
        candidate['episode']['episodeNumber'],
        0 if candidate['precision'] == 'date' else 1,
        candidate['air_at'] if candidate['precision'] == 'datetime' else datetime.min.replace(tzinfo=UTC),
        candidate['episode']['id'],
    )


def _first_episode_number(item: dict[str, Any]) -> int:
    episodes = item['episodes']
    return episodes[0]['episodeNumber'] if episodes else 0


def _item_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    schedule = item['scheduleSummary']
    return (
        0 if schedule['hasDatePrecision'] else 1,
        schedule['earliestExactAirAt'] or '',
        item['anime']['displayName'].casefold(),
        _first_episode_number(item),
        item['anime']['id'],
    )


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _iso_utc(value: datetime) -> str:
    return _aware_utc(value).isoformat().replace('+00:00', 'Z')


def _start_of_week(value: date, week_start_day: int) -> date:
    return value - timedelta(days=(value.weekday() - week_start_day) % 7)


def _require_calendar_invariant(*, condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)
