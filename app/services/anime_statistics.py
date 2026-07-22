from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import (
    Integer,
    String,
    and_,
    case,
    cast,
    false,
    func,
    literal,
    or_,
    select,
    union_all,
)
from sqlalchemy.orm import Session, selectinload

from app.api.utils.serializers import select_anime_name_for_user, select_episode_name_for_user
from app.models.anime import AnimeMetaInfo, Episode, EpisodeStatus
from app.models.anime_utils import episode_effectively_aired_condition
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
    episodes = _active_episode_rows(user.id, now=calculated_at)
    active = episodes.c.anime_status != UserAnimeStatus.DROPPED.value
    watched = and_(active, episodes.c.watched.is_(True))
    unwatched_aired_conditions = [
        active,
        episodes.c.watched.is_(False),
        episodes.c.status == EpisodeStatus.AIRED.value,
        episodes.c.anime_status != UserAnimeStatus.ON_HOLD.value,
    ]
    if not user.include_unwatched_season_zero_in_statistics:
        unwatched_aired_conditions.append(
            ~_season_zero_condition(episodes.c.source_provider, episodes.c.source_external_id),
        )
    unwatched_aired = and_(*unwatched_aired_conditions)

    watched_episode_count, unwatched_aired_episode_count = session.execute(
        select(
            func.coalesce(func.sum(case((watched, 1), else_=0)), 0),
            func.coalesce(func.sum(case((unwatched_aired, 1), else_=0)), 0),
        ).select_from(episodes),
    ).one()
    library_anime_count = session.scalar(
        select(func.count(UserAnimeProgress.id)).where(
            UserAnimeProgress.user_id == user.id,
            UserAnimeProgress.status != UserAnimeStatus.DROPPED,
        ),
    ) or 0
    watched_rows = session.execute(
        select(episodes.c.episode_id, episodes.c.source, episodes.c.duration, episodes.c.watched_at)
        .where(watched)
        .order_by(episodes.c.source, episodes.c.episode_id),
    ).all()

    durations = [parse_duration_seconds(row.duration) for row in watched_rows]
    total_watch_seconds = sum(seconds for seconds in durations if seconds is not None)
    unknown_duration_count = sum(seconds is None for seconds in durations)
    daily_counts: dict[date, int] = defaultdict(int)
    daily_seconds: dict[date, int] = defaultdict(int)
    weekly_counts: dict[date, int] = defaultdict(int)
    weekly_seconds: dict[date, int] = defaultdict(int)
    for row in watched_rows:
        if row.watched_at is None:
            continue
        watched_date = _aware_utc(row.watched_at).astimezone(time_zone).date()
        if watched_date < first_day or watched_date > last_day:
            continue
        seconds = parse_duration_seconds(row.duration)
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
    statistics_version = _statistics_version(
        user,
        watched_episode_count,
        unwatched_aired_episode_count,
        library_anime_count,
        total_watch_seconds,
        unknown_duration_count,
        tuple((row.source, row.episode_id, _iso_utc(row.watched_at)) for row in watched_rows),
    )
    return {
        'status': 'ready',
        'statisticsVersion': statistics_version,
        'calculatedAt': _iso_utc(calculated_at),
        'timeZone': user.time_zone,
        'watchedEpisodeCount': watched_episode_count,
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
    episodes = _active_episode_rows(user.id, now=datetime.now(UTC))
    timeline_filter = and_(
        episodes.c.anime_status != UserAnimeStatus.DROPPED.value,
        episodes.c.watched.is_(True),
        episodes.c.watched_at.is_not(None),
    )
    total, latest_watched_at = session.execute(
        select(func.count(), func.max(episodes.c.watched_at)).select_from(episodes).where(timeline_filter),
    ).one()
    page = session.execute(
        select(episodes)
        .where(timeline_filter)
        .order_by(episodes.c.watched_at.desc(), episodes.c.source.desc(), episodes.c.episode_id.desc())
        .limit(limit)
        .offset(offset),
    ).all()

    progress_ids = {row.progress_id for row in page}
    progresses = session.scalars(
        select(UserAnimeProgress)
        .options(
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.posters),
        )
        .where(UserAnimeProgress.id.in_(progress_ids)),
    ).all() if progress_ids else []
    progress_by_id = {progress.id: progress for progress in progresses}

    upstream_episode_ids = {
        row.episode_id for row in page if row.source == UserAnimeMetadataSource.UPSTREAM.value
    }
    upstream_episodes = session.scalars(
        select(Episode)
        .options(selectinload(Episode.names))
        .where(Episode.id.in_(upstream_episode_ids)),
    ).all() if upstream_episode_ids else []
    upstream_episode_by_id = {episode.id: episode for episode in upstream_episodes}

    items = []
    for row in page:
        progress = progress_by_id[row.progress_id]
        if row.source == UserAnimeMetadataSource.UPSTREAM.value:
            episode = upstream_episode_by_id[row.episode_id]
            anime_name = select_anime_name_for_user(sorted(progress.anime.names, key=lambda item: item.id), progress, user)
            episode_name = select_episode_name_for_user(
                sorted(episode.names, key=lambda item: item.id),
                user,
                preferred_name_id=row.preferred_episode_name_id,
            )
            display_anime_name = anime_name.name if anime_name is not None else progress.anime.original_name
            display_episode_name = episode_name.name if episode_name is not None else episode.original_title
        else:
            display_anime_name = row.snapshot_anime_name
            display_episode_name = row.snapshot_episode_name
        items.append(
            {
                'anime': {
                    'id': row.anime_id,
                    'displayName': display_anime_name,
                    'posterUrl': _poster_url(progress.anime, progress),
                },
                'episode': {
                    'id': row.episode_id,
                    'source': row.source,
                    'episodeNumber': row.episode_number,
                    'displayName': display_episode_name,
                    'duration': row.duration,
                    'durationSeconds': parse_duration_seconds(row.duration),
                    'watchedAt': _iso_utc(row.watched_at),
                    'localDate': _aware_utc(row.watched_at).astimezone(time_zone).date().isoformat(),
                },
            },
        )

    return {
        'items': items,
        'total': total,
        'limit': limit,
        'offset': offset,
        'hasMore': offset + len(items) < total,
        'statisticsVersion': _statistics_version(user, total, _iso_utc(latest_watched_at)),
        'timeZone': user.time_zone,
    }


def start_of_week(value: date, week_start_day: int) -> date:
    return value - timedelta(days=(value.weekday() - week_start_day) % 7)


def _active_episode_rows(user_id: int, *, now: datetime):  # type: ignore[no-untyped-def]
    local_source = UserAnimeMetadataSource.LOCAL_SNAPSHOT.value
    upstream = (
        select(
            literal(UserAnimeMetadataSource.UPSTREAM.value, String(32)).label('source'),
            UserAnimeProgress.id.label('progress_id'),
            UserAnimeProgress.anime_id.label('anime_id'),
            Episode.id.label('episode_id'),
            Episode.episode_number.label('episode_number'),
            case(
                (episode_effectively_aired_condition(Episode, now=now), EpisodeStatus.AIRED.value),
                else_=cast(Episode.status, String(32)),
            ).label('status'),
            Episode.duration.label('duration'),
            func.coalesce(UserEpisodeProgress.watched, false()).label('watched'),
            UserEpisodeProgress.watched_at.label('watched_at'),
            cast(UserAnimeProgress.status, String(32)).label('anime_status'),
            AnimeMetaInfo.provider_type.label('source_provider'),
            AnimeMetaInfo.external_id.label('source_external_id'),
            UserEpisodeProgress.preferred_name_id.label('preferred_episode_name_id'),
            literal(None, String(255)).label('snapshot_anime_name'),
            literal(None, String(255)).label('snapshot_episode_name'),
        )
        .select_from(UserAnimeProgress)
        .join(AnimeMetaInfo, AnimeMetaInfo.id == UserAnimeProgress.anime_id)
        .join(Episode, Episode.anime_id == UserAnimeProgress.anime_id)
        .outerjoin(
            UserEpisodeProgress,
            and_(
                UserEpisodeProgress.user_id == user_id,
                UserEpisodeProgress.episode_id == Episode.id,
            ),
        )
        .where(
            UserAnimeProgress.user_id == user_id,
            or_(
                UserAnimeProgress.metadata_source != local_source,
                UserAnimeProgress.metadata_snapshot_id.is_(None),
            ),
        )
    )
    local = (
        select(
            literal(local_source, String(32)).label('source'),
            UserAnimeProgress.id.label('progress_id'),
            UserAnimeProgress.anime_id.label('anime_id'),
            UserAnimeMetadataEpisodeSnapshot.id.label('episode_id'),
            UserAnimeMetadataEpisodeSnapshot.episode_number.label('episode_number'),
            UserAnimeMetadataEpisodeSnapshot.status.label('status'),
            UserAnimeMetadataEpisodeSnapshot.duration.label('duration'),
            UserAnimeMetadataEpisodeSnapshot.watched.label('watched'),
            UserAnimeMetadataEpisodeSnapshot.watched_at.label('watched_at'),
            cast(UserAnimeProgress.status, String(32)).label('anime_status'),
            UserAnimeMetadataSnapshot.source_provider.label('source_provider'),
            UserAnimeMetadataSnapshot.source_external_id.label('source_external_id'),
            literal(None, Integer).label('preferred_episode_name_id'),
            UserAnimeMetadataSnapshot.source_title.label('snapshot_anime_name'),
            UserAnimeMetadataEpisodeSnapshot.title.label('snapshot_episode_name'),
        )
        .select_from(UserAnimeProgress)
        .join(UserAnimeMetadataSnapshot, UserAnimeMetadataSnapshot.id == UserAnimeProgress.metadata_snapshot_id)
        .join(
            UserAnimeMetadataEpisodeSnapshot,
            UserAnimeMetadataEpisodeSnapshot.snapshot_id == UserAnimeMetadataSnapshot.id,
        )
        .where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.metadata_source == local_source,
            UserAnimeProgress.metadata_snapshot_id.is_not(None),
        )
    )
    return union_all(upstream, local).cte('active_statistics_episodes')


def _season_zero_condition(provider: Any, external_id: Any):  # type: ignore[no-untyped-def]
    return or_(
        and_(provider == 'tvdb', external_id.like('%:0')),
        and_(provider == 'tmdb', external_id.like('tv:%'), external_id.like('%:season:0%')),
    )


def _statistics_version(user: User, *values: Any) -> str:
    digest = sha256()
    digest.update(f'{user.id}:{user.time_zone}:{user.week_start_day}:{user.include_unwatched_season_zero_in_statistics}'.encode())
    digest.update(repr(values).encode())
    return digest.hexdigest()[:16]


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _aware_utc(value).isoformat().replace('+00:00', 'Z')


def _poster_url(anime: AnimeMetaInfo, progress: UserAnimeProgress) -> str | None:
    if not anime.posters:
        return None
    poster = None
    if progress.preferred_poster_id is not None:
        poster = next((item for item in anime.posters if item.id == progress.preferred_poster_id), None)
    if poster is None:
        poster = min(anime.posters, key=lambda item: (item.status != 'ready', item.id))
    return f'/api/anime/{anime.id}/assets/poster?v={poster.id}-{poster.status}'
