from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.utils.serializers import select_anime_name_for_user, select_episode_name_for_user
from app.models.anime import AnimeMetaInfo, Episode, EpisodeStatus
from app.models.progress import UserAnimeProgress, UserAnimeStatus, UserEpisodeProgress
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
    today = today or datetime.now(UTC).date()
    week_start_day = user.week_start_day
    current_week_start = start_of_week(today, week_start_day)
    first_week_start = current_week_start - timedelta(weeks=WEEKLY_STATISTICS_WEEKS - 1)
    first_day = current_week_start - timedelta(weeks=DAILY_STATISTICS_WEEKS - 1)
    last_day = first_day + timedelta(days=DAILY_STATISTICS_WEEKS * 7 - 1)

    library_anime_count = session.scalar(
        select(func.count(UserAnimeProgress.id)).where(
            UserAnimeProgress.user_id == user.id,
            UserAnimeProgress.status != UserAnimeStatus.DROPPED,
        ),
    ) or 0

    watched_episode_count = session.scalar(
        _watched_episode_base_stmt(user.id).with_only_columns(func.count(UserEpisodeProgress.id)).order_by(None),
    ) or 0

    watched_episode_ids = select(UserEpisodeProgress.episode_id).where(
        UserEpisodeProgress.user_id == user.id,
        UserEpisodeProgress.watched.is_(True),
    )
    unwatched_aired_episode_count = session.scalar(
        select(func.count(Episode.id))
        .join(UserAnimeProgress, UserAnimeProgress.anime_id == Episode.anime_id)
        .where(
            UserAnimeProgress.user_id == user.id,
            UserAnimeProgress.status.not_in([UserAnimeStatus.DROPPED, UserAnimeStatus.ON_HOLD]),
            Episode.status == EpisodeStatus.AIRED,
            Episode.id.not_in(watched_episode_ids),
        ),
    ) or 0

    watched_rows = session.execute(
        _watched_episode_base_stmt(user.id).with_only_columns(UserEpisodeProgress.watched_at, Episode.duration),
    ).all()
    total_watch_seconds = sum(
        seconds
        for _watched_at, duration in watched_rows
        if (seconds := parse_duration_seconds(duration)) is not None
    )

    daily_counts: dict[date, int] = defaultdict(int)
    daily_seconds: dict[date, int] = defaultdict(int)
    weekly_counts: dict[date, int] = defaultdict(int)
    weekly_seconds: dict[date, int] = defaultdict(int)
    for watched_at, duration in watched_rows:
        if watched_at is None:
            continue
        watched_date = _aware_utc(watched_at).date()
        if watched_date < first_day or watched_date > last_day:
            continue
        seconds = parse_duration_seconds(duration)
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
        'watchedEpisodeCount': watched_episode_count,
        'unwatchedAiredEpisodeCount': unwatched_aired_episode_count,
        'libraryAnimeCount': library_anime_count,
        'totalWatchSeconds': total_watch_seconds,
        'averageWeeklyWatchedEpisodesLastQuarter': round(quarter_watched_count / WEEKLY_STATISTICS_WEEKS, 2),
        'weekStartDay': week_start_day,
        'daily': daily,
        'weekly': weekly,
    }


def get_watch_timeline(session: Session, user: User, *, limit: int, offset: int) -> dict[str, Any]:
    limit, offset = validate_pagination(limit, offset, max_limit=100)
    base_conditions = (
        UserEpisodeProgress.user_id == user.id,
        UserEpisodeProgress.watched.is_(True),
        UserEpisodeProgress.watched_at.is_not(None),
        UserAnimeProgress.user_id == user.id,
        UserAnimeProgress.status != UserAnimeStatus.DROPPED,
    )
    total = session.scalar(
        select(func.count(UserEpisodeProgress.id))
        .join(Episode, Episode.id == UserEpisodeProgress.episode_id)
        .join(UserAnimeProgress, UserAnimeProgress.anime_id == Episode.anime_id)
        .where(*base_conditions),
    ) or 0
    progresses = session.scalars(
        select(UserEpisodeProgress)
        .options(
            selectinload(UserEpisodeProgress.episode).selectinload(Episode.names),
            selectinload(UserEpisodeProgress.episode).selectinload(Episode.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserEpisodeProgress.episode).selectinload(Episode.anime).selectinload(AnimeMetaInfo.posters),
            selectinload(UserEpisodeProgress.episode).selectinload(Episode.anime).selectinload(AnimeMetaInfo.summaries),
        )
        .join(Episode, Episode.id == UserEpisodeProgress.episode_id)
        .join(UserAnimeProgress, UserAnimeProgress.anime_id == Episode.anime_id)
        .where(*base_conditions)
        .order_by(UserEpisodeProgress.watched_at.desc(), UserEpisodeProgress.id.desc())
        .limit(limit)
        .offset(offset),
    ).all()
    progress_by_anime = {
        progress.anime_id: progress
        for progress in session.scalars(
            select(UserAnimeProgress).where(
                UserAnimeProgress.user_id == user.id,
                UserAnimeProgress.anime_id.in_({item.episode.anime_id for item in progresses}),
            ),
        ).all()
    }

    items = []
    for progress in progresses:
        episode = progress.episode
        anime = episode.anime
        anime_progress = progress_by_anime[anime.id]
        anime_name = select_anime_name_for_user(sorted(anime.names, key=lambda item: item.id), anime_progress, user)
        episode_name = select_episode_name_for_user(
            sorted(episode.names, key=lambda item: item.id),
            user,
            preferred_name_id=progress.preferred_name_id,
        )
        duration_seconds = parse_duration_seconds(episode.duration)
        items.append(
            {
                'anime': {
                    'id': anime.id,
                    'displayName': anime_name.name if anime_name is not None else anime.original_name,
                    'posterUrl': _poster_url(anime, anime_progress),
                },
                'episode': {
                    'id': episode.id,
                    'episodeNumber': episode.episode_number,
                    'displayName': episode_name.name if episode_name is not None else episode.original_title,
                    'duration': episode.duration,
                    'durationSeconds': duration_seconds,
                    'watchedAt': progress.watched_at.isoformat() if progress.watched_at is not None else None,
                },
            },
        )

    return {'items': items, 'total': total, 'limit': limit, 'offset': offset, 'hasMore': offset + limit < total}


def start_of_week(value: date, week_start_day: int) -> date:
    return value - timedelta(days=(value.weekday() - week_start_day) % 7)


def _watched_episode_base_stmt(user_id: int):  # type: ignore[no-untyped-def]
    return (
        select(UserEpisodeProgress.id)
        .join(Episode, Episode.id == UserEpisodeProgress.episode_id)
        .join(
            UserAnimeProgress,
            and_(
                UserAnimeProgress.anime_id == Episode.anime_id,
                UserAnimeProgress.user_id == user_id,
            ),
        )
        .where(
            UserEpisodeProgress.user_id == user_id,
            UserEpisodeProgress.watched.is_(True),
            UserAnimeProgress.status != UserAnimeStatus.DROPPED,
        )
    )


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _poster_url(anime: AnimeMetaInfo, progress: UserAnimeProgress) -> str | None:
    if not anime.posters:
        return None
    poster = None
    if progress.preferred_poster_id is not None:
        poster = next((item for item in anime.posters if item.id == progress.preferred_poster_id), None)
    if poster is None:
        poster = min(anime.posters, key=lambda item: (item.status != 'ready', item.id))
    return f'/api/anime/{anime.id}/assets/poster?v={poster.id}-{poster.status}'
