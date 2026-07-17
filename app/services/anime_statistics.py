from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, selectinload

from app.api.utils.serializers import select_anime_name_for_user, select_episode_name_for_user
from app.models.anime import AnimeMetaInfo, Episode, EpisodeStatus
from app.models.progress import (
    UserAnimeMetadataEpisodeSnapshot,
    UserAnimeMetadataSnapshot,
    UserAnimeMetadataSource,
    UserAnimeProgress,
    UserAnimeStatus,
    UserEpisodeProgress,
)
from app.models.user import User
from app.models.validater import validate_pagination

DAILY_STATISTICS_WEEKS = 53
WEEKLY_STATISTICS_WEEKS = 13


@dataclass(frozen=True)
class StatisticsEpisode:
    source: str
    anime_id: int
    episode_id: int
    episode_number: int
    anime_name: str
    anime_poster_url: str | None
    episode_name: str | None
    status: str
    duration: str | None
    watched: bool
    watched_at: datetime | None
    anime_status: UserAnimeStatus
    is_season_zero: bool


def parse_duration_seconds(duration: str | None) -> int | None:
    if duration is None:
        return None
    parts = duration.split(':')
    if len(parts) != 3:
        return None
    try:
        hours, minutes, seconds = (int(part) for part in parts)
    except ValueError:
        return None
    if minutes < 0 or minutes > 59 or seconds < 0 or seconds > 59 or hours < 0:
        return None
    return hours * 3600 + minutes * 60 + seconds


def get_statistics_summary(session: Session, user: User, *, today: date | None = None) -> dict[str, Any]:
    time_zone = ZoneInfo(user.time_zone)
    calculated_at = datetime.now(UTC)
    today = today or calculated_at.astimezone(time_zone).date()
    week_start_day = user.week_start_day
    current_week_start = start_of_week(today, week_start_day)
    first_week_start = current_week_start - timedelta(weeks=WEEKLY_STATISTICS_WEEKS - 1)
    first_day = current_week_start - timedelta(weeks=DAILY_STATISTICS_WEEKS - 1)
    last_day = first_day + timedelta(days=DAILY_STATISTICS_WEEKS * 7 - 1)
    episodes = _statistics_episodes(session, user)
    active_episodes = [episode for episode in episodes if episode.anime_status != UserAnimeStatus.DROPPED]
    watched_episodes = [episode for episode in active_episodes if episode.watched]

    library_anime_count = len({episode.anime_id for episode in active_episodes})
    # Anime without episodes are still part of the active library.
    library_anime_count += _active_library_anime_without_episodes(session, user, active_episodes)
    unwatched_aired_episode_count = sum(
        1
        for episode in active_episodes
        if not episode.watched
        and episode.status == EpisodeStatus.AIRED.value
        and episode.anime_status != UserAnimeStatus.ON_HOLD
        and (user.include_unwatched_season_zero_in_statistics or not episode.is_season_zero)
    )
    durations = [parse_duration_seconds(episode.duration) for episode in watched_episodes]
    total_watch_seconds = sum(seconds for seconds in durations if seconds is not None)
    unknown_duration_count = sum(seconds is None for seconds in durations)

    daily_counts: dict[date, int] = defaultdict(int)
    daily_seconds: dict[date, int] = defaultdict(int)
    weekly_counts: dict[date, int] = defaultdict(int)
    weekly_seconds: dict[date, int] = defaultdict(int)
    for episode in watched_episodes:
        if episode.watched_at is None:
            continue
        watched_date = _aware_utc(episode.watched_at).astimezone(time_zone).date()
        if watched_date < first_day or watched_date > last_day:
            continue
        seconds = parse_duration_seconds(episode.duration)
        week_start = start_of_week(watched_date, week_start_day)
        daily_counts[watched_date] += 1
        weekly_counts[week_start] += 1
        if seconds is not None:
            daily_seconds[watched_date] += seconds
            weekly_seconds[week_start] += seconds

    daily = [
        {
            'date': day.isoformat(),
            'watchedEpisodeCount': daily_counts[day],
            'watchSeconds': daily_seconds[day],
        }
        for index in range(DAILY_STATISTICS_WEEKS * 7)
        if (day := first_day + timedelta(days=index)) <= today
    ]
    weekly = [
        {
            'weekStartDate': week_start.isoformat(),
            'weekEndDate': (week_start + timedelta(days=6)).isoformat(),
            'watchedEpisodeCount': weekly_counts[week_start],
            'watchSeconds': weekly_seconds[week_start],
        }
        for index in range(WEEKLY_STATISTICS_WEEKS)
        if (week_start := first_week_start + timedelta(weeks=index)) <= current_week_start
    ]
    quarter_watched_count = sum(
        weekly_counts[first_week_start + timedelta(weeks=index)]
        for index in range(WEEKLY_STATISTICS_WEEKS)
    )
    return {
        'status': 'ready',
        'statisticsVersion': _statistics_version(episodes, user),
        'calculatedAt': _iso_utc(calculated_at),
        'timeZone': user.time_zone,
        'watchedEpisodeCount': len(watched_episodes),
        'unwatchedAiredEpisodeCount': unwatched_aired_episode_count,
        'libraryAnimeCount': library_anime_count,
        'totalWatchSeconds': total_watch_seconds,
        'unknownDurationEpisodeCount': unknown_duration_count,
        'averageWeeklyWatchedEpisodesLastQuarter': round(quarter_watched_count / WEEKLY_STATISTICS_WEEKS, 2),
        'weekStartDay': week_start_day,
        'daily': daily,
        'weekly': weekly,
    }


def get_watch_timeline(session: Session, user: User, *, limit: int, offset: int) -> dict[str, Any]:
    limit, offset = validate_pagination(limit, offset, max_limit=100)
    time_zone = ZoneInfo(user.time_zone)
    episodes = [
        episode
        for episode in _statistics_episodes(session, user)
        if episode.anime_status != UserAnimeStatus.DROPPED and episode.watched and episode.watched_at is not None
    ]
    episodes.sort(
        key=lambda episode: (_aware_utc(episode.watched_at or datetime.min.replace(tzinfo=UTC)), episode.source, episode.episode_id),
        reverse=True,
    )
    total = len(episodes)
    page = episodes[offset:offset + limit]
    items = [
        {
            'anime': {
                'id': episode.anime_id,
                'displayName': episode.anime_name,
                'posterUrl': episode.anime_poster_url,
            },
            'episode': {
                'id': episode.episode_id,
                'source': episode.source,
                'episodeNumber': episode.episode_number,
                'displayName': episode.episode_name,
                'duration': episode.duration,
                'durationSeconds': parse_duration_seconds(episode.duration),
                'watchedAt': _iso_utc(episode.watched_at),
                'localDate': _aware_utc(episode.watched_at).astimezone(time_zone).date().isoformat(),
            },
        }
        for episode in page
        if episode.watched_at is not None
    ]
    return {
        'items': items,
        'total': total,
        'limit': limit,
        'offset': offset,
        'hasMore': offset + len(items) < total,
        'statisticsVersion': _statistics_version(episodes, user),
        'timeZone': user.time_zone,
    }


def start_of_week(value: date, week_start_day: int) -> date:
    return value - timedelta(days=(value.weekday() - week_start_day) % 7)


def _statistics_episodes(session: Session, user: User) -> list[StatisticsEpisode]:
    progresses = session.scalars(
        select(UserAnimeProgress)
        .options(
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.posters),
        )
        .where(UserAnimeProgress.user_id == user.id),
    ).all()
    result: list[StatisticsEpisode] = []
    for progress in progresses:
        if progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value and progress.metadata_snapshot_id is not None:
            snapshot = session.get(UserAnimeMetadataSnapshot, progress.metadata_snapshot_id)
            if snapshot is not None:
                result.extend(_local_snapshot_episodes(session, progress, snapshot))
            continue
        result.extend(_upstream_episodes(session, user, progress))
    return result


def _upstream_episodes(session: Session, user: User, progress: UserAnimeProgress) -> list[StatisticsEpisode]:
    rows = session.execute(
        select(Episode, UserEpisodeProgress)
        .options(selectinload(Episode.names))
        .outerjoin(
            UserEpisodeProgress,
            and_(UserEpisodeProgress.episode_id == Episode.id, UserEpisodeProgress.user_id == user.id),
        )
        .where(Episode.anime_id == progress.anime_id),
    ).all()
    anime = progress.anime
    anime_name = select_anime_name_for_user(sorted(anime.names, key=lambda item: item.id), progress, user)
    display_name = anime_name.name if anime_name is not None else anime.original_name
    poster_url = _poster_url(anime, progress)
    season_zero = _is_season_zero(anime.provider_type, anime.external_id)
    result = []
    for episode, episode_progress in rows:
        episode_name = select_episode_name_for_user(
            sorted(episode.names, key=lambda item: item.id),
            user,
            preferred_name_id=episode_progress.preferred_name_id if episode_progress is not None else None,
        )
        result.append(
            StatisticsEpisode(
                source=UserAnimeMetadataSource.UPSTREAM.value,
                anime_id=anime.id,
                episode_id=episode.id,
                episode_number=episode.episode_number,
                anime_name=display_name,
                anime_poster_url=poster_url,
                episode_name=episode_name.name if episode_name is not None else episode.original_title,
                status=episode.status.value,
                duration=episode.duration,
                watched=bool(episode_progress and episode_progress.watched),
                watched_at=episode_progress.watched_at if episode_progress is not None else None,
                anime_status=progress.status,
                is_season_zero=season_zero,
            ),
        )
    return result


def _local_snapshot_episodes(
    session: Session,
    progress: UserAnimeProgress,
    snapshot: UserAnimeMetadataSnapshot,
) -> list[StatisticsEpisode]:
    rows = session.scalars(
        select(UserAnimeMetadataEpisodeSnapshot)
        .where(UserAnimeMetadataEpisodeSnapshot.snapshot_id == snapshot.id),
    ).all()
    return [
        StatisticsEpisode(
            source=UserAnimeMetadataSource.LOCAL_SNAPSHOT.value,
            anime_id=progress.anime_id,
            episode_id=episode.id,
            episode_number=episode.episode_number,
            anime_name=snapshot.source_title,
            anime_poster_url=_poster_url(progress.anime, progress),
            episode_name=episode.title,
            status=episode.status,
            duration=episode.duration,
            watched=episode.watched,
            watched_at=episode.watched_at,
            anime_status=progress.status,
            is_season_zero=_is_season_zero(snapshot.source_provider, snapshot.source_external_id),
        )
        for episode in rows
    ]


def _active_library_anime_without_episodes(
    session: Session,
    user: User,
    episodes: list[StatisticsEpisode],
) -> int:
    anime_ids = {episode.anime_id for episode in episodes}
    progresses = session.scalars(
        select(UserAnimeProgress).where(
            UserAnimeProgress.user_id == user.id,
            UserAnimeProgress.status != UserAnimeStatus.DROPPED,
        ),
    ).all()
    return sum(progress.anime_id not in anime_ids for progress in progresses)


def _statistics_version(episodes: list[StatisticsEpisode], user: User) -> str:
    digest = sha256()
    digest.update(f'{user.id}:{user.time_zone}:{user.week_start_day}:{user.include_unwatched_season_zero_in_statistics}'.encode())
    for episode in sorted(episodes, key=lambda item: (item.source, item.anime_id, item.episode_id)):
        digest.update(
            repr(
                (
                    episode.source,
                    episode.anime_id,
                    episode.episode_id,
                    episode.status,
                    episode.duration,
                    episode.watched,
                    _iso_utc(episode.watched_at),
                    episode.anime_status.value,
                ),
            ).encode(),
        )
    return digest.hexdigest()[:16]


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _aware_utc(value).isoformat().replace('+00:00', 'Z')


def _is_season_zero(provider: str, external_id: str) -> bool:
    return (provider == 'tvdb' and external_id.endswith(':0')) or (
        provider == 'tmdb' and external_id.startswith('tv:') and ':season:0' in external_id
    )


def _poster_url(anime: AnimeMetaInfo, progress: UserAnimeProgress) -> str | None:
    if not anime.posters:
        return None
    poster = None
    if progress.preferred_poster_id is not None:
        poster = next((item for item in anime.posters if item.id == progress.preferred_poster_id), None)
    if poster is None:
        poster = min(anime.posters, key=lambda item: (item.status != 'ready', item.id))
    return f'/api/anime/{anime.id}/assets/poster?v={poster.id}-{poster.status}'
