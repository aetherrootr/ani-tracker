from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session, aliased, selectinload

from app.models.anime import AnimeMetaInfo, Episode, EpisodeStatus
from app.models.progress import UserAnimeProgress, UserAnimeStatus, UserEpisodeProgress


@dataclass(frozen=True)
class TrackingListQueryRow:
    progress_id: int
    anime_id: int
    episode_id: int
    watched_episode_count: int
    aired_episode_count: int


@dataclass(frozen=True)
class RecentlyWatchedQueryRow:
    progress_id: int
    anime_id: int
    episode_id: int
    watched_at: datetime
    watched_episode_count: int
    aired_episode_count: int


def get_tracking_list_rows(
    session: Session,
    *,
    user_id: int,
    limit: int,
    offset: int,
    now: datetime,
    recent_days: int,
) -> tuple[int, list[TrackingListQueryRow]]:
    return _get_tracking_list_rows(
        session,
        user_id=user_id,
        limit=limit,
        offset=offset,
        now=now,
        recent_days=recent_days,
        section='tracking',
    )


def get_backlog_list_rows(
    session: Session,
    *,
    user_id: int,
    limit: int,
    offset: int,
    now: datetime,
    recent_days: int,
) -> tuple[int, list[TrackingListQueryRow]]:
    return _get_tracking_list_rows(
        session,
        user_id=user_id,
        limit=limit,
        offset=offset,
        now=now,
        recent_days=recent_days,
        section='backlog',
    )


def get_progresses_by_ids_with_anime(
    session: Session,
    progress_ids: Sequence[int],
) -> dict[int, UserAnimeProgress]:
    if not progress_ids:
        return {}
    progresses = session.scalars(
        select(UserAnimeProgress)
        .options(
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.summaries),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.episodes).selectinload(Episode.names),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.posters),
        )
        .where(UserAnimeProgress.id.in_(progress_ids)),
    ).all()
    return {progress.id: progress for progress in progresses}


def get_recently_watched_rows(
    session: Session,
    *,
    user_id: int,
    limit: int,
    offset: int,
) -> tuple[int, list[RecentlyWatchedQueryRow]]:
    watched_count_episode = aliased(Episode)
    watched_count_progress = aliased(UserEpisodeProgress)
    watched_count_subquery = (
        select(
            watched_count_episode.anime_id.label('anime_id'),
            func.count(watched_count_progress.id).label('watched_episode_count'),
        )
        .join(watched_count_progress, watched_count_progress.episode_id == watched_count_episode.id)
        .where(
            watched_count_progress.user_id == user_id,
            watched_count_progress.watched.is_(True),
        )
        .group_by(watched_count_episode.anime_id)
        .subquery()
    )
    aired_count_subquery = (
        select(
            Episode.anime_id.label('anime_id'),
            func.count(Episode.id).label('aired_episode_count'),
        )
        .where(Episode.status == EpisodeStatus.AIRED)
        .group_by(Episode.anime_id)
        .subquery()
    )
    base_query = (
        select(
            UserAnimeProgress.id.label('progress_id'),
            AnimeMetaInfo.id.label('anime_id'),
            Episode.id.label('episode_id'),
            UserEpisodeProgress.watched_at.label('watched_at'),
            func.coalesce(watched_count_subquery.c.watched_episode_count, 0).label('watched_episode_count'),
            func.coalesce(aired_count_subquery.c.aired_episode_count, 0).label('aired_episode_count'),
        )
        .join(UserEpisodeProgress.episode)
        .join(Episode.anime)
        .join(
            UserAnimeProgress,
            (UserAnimeProgress.anime_id == AnimeMetaInfo.id) & (UserAnimeProgress.user_id == user_id),
        )
        .outerjoin(watched_count_subquery, watched_count_subquery.c.anime_id == AnimeMetaInfo.id)
        .outerjoin(aired_count_subquery, aired_count_subquery.c.anime_id == AnimeMetaInfo.id)
        .where(
            UserEpisodeProgress.user_id == user_id,
            UserEpisodeProgress.watched.is_(True),
            UserEpisodeProgress.watched_at.is_not(None),
            UserAnimeProgress.status != UserAnimeStatus.DROPPED,
        )
    )
    total = session.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    rows = session.execute(
        base_query.order_by(UserEpisodeProgress.watched_at.desc(), AnimeMetaInfo.original_name, Episode.episode_number)
        .limit(limit)
        .offset(offset),
    ).all()
    return total, [
        RecentlyWatchedQueryRow(
            progress_id=row.progress_id,
            anime_id=row.anime_id,
            episode_id=row.episode_id,
            watched_at=row.watched_at,
            watched_episode_count=row.watched_episode_count,
            aired_episode_count=row.aired_episode_count,
        )
        for row in rows
    ]


def _get_tracking_list_rows(
    session: Session,
    *,
    user_id: int,
    limit: int,
    offset: int,
    now: datetime,
    recent_days: int,
    section: str,
) -> tuple[int, list[TrackingListQueryRow]]:
    selected_episode = aliased(Episode)
    query_parts = _tracking_list_query_parts(user_id=user_id, now=now, recent_days=recent_days)
    section_condition = query_parts['tracking_condition'] if section == 'tracking' else ~query_parts['tracking_condition']
    base_query = (
        select(
            UserAnimeProgress.id.label('progress_id'),
            UserAnimeProgress.anime_id.label('anime_id'),
            selected_episode.id.label('episode_id'),
            func.coalesce(query_parts['watched_count_subquery'].c.watched_episode_count, 0).label('watched_episode_count'),
            query_parts['episode_stats_subquery'].c.aired_episode_count.label('aired_episode_count'),
        )
        .join(UserAnimeProgress.anime)
        .join(query_parts['next_episode_subquery'], query_parts['next_episode_subquery'].c.anime_id == AnimeMetaInfo.id)
        .join(
            selected_episode,
            and_(
                selected_episode.anime_id == AnimeMetaInfo.id,
                selected_episode.episode_number == query_parts['next_episode_subquery'].c.episode_number,
            ),
        )
        .join(query_parts['episode_stats_subquery'], query_parts['episode_stats_subquery'].c.anime_id == AnimeMetaInfo.id)
        .outerjoin(query_parts['watched_count_subquery'], query_parts['watched_count_subquery'].c.anime_id == AnimeMetaInfo.id)
        .where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.status != UserAnimeStatus.DROPPED,
            section_condition,
        )
    )
    total = session.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    order_by = (
        selected_episode.air_at.is_(None),
        selected_episode.air_at.desc(),
        AnimeMetaInfo.original_name,
        UserAnimeProgress.anime_id,
    ) if section == 'tracking' else (
        AnimeMetaInfo.air_date.is_(None),
        AnimeMetaInfo.air_date.desc(),
        AnimeMetaInfo.original_name,
        UserAnimeProgress.anime_id,
    )
    rows = session.execute(base_query.order_by(*order_by).limit(limit).offset(offset)).all()
    return total, [
        TrackingListQueryRow(
            progress_id=row.progress_id,
            anime_id=row.anime_id,
            episode_id=row.episode_id,
            watched_episode_count=row.watched_episode_count,
            aired_episode_count=row.aired_episode_count,
        )
        for row in rows
    ]


def _tracking_list_query_parts(*, user_id: int, now: datetime, recent_days: int) -> dict[str, object]:
    next_episode = aliased(Episode)
    watched_next_progress = aliased(UserEpisodeProgress)
    future_episode = aliased(Episode)
    watched_count_episode = aliased(Episode)
    watched_count_progress = aliased(UserEpisodeProgress)

    watched_next_exists = exists(
        select(1).where(
            watched_next_progress.episode_id == next_episode.id,
            watched_next_progress.user_id == user_id,
            watched_next_progress.watched.is_(True),
        ),
    )
    next_episode_subquery = (
        select(
            next_episode.anime_id.label('anime_id'),
            func.min(next_episode.episode_number).label('episode_number'),
        )
        .where(
            next_episode.status == EpisodeStatus.AIRED,
            ~watched_next_exists,
        )
        .group_by(next_episode.anime_id)
        .subquery()
    )
    episode_stats_subquery = (
        select(
            Episode.anime_id.label('anime_id'),
            func.count(Episode.id).label('imported_episode_count'),
            func.count(Episode.id).filter(Episode.status == EpisodeStatus.AIRED).label('aired_episode_count'),
            func.max(Episode.air_at).filter(Episode.status == EpisodeStatus.AIRED).label('last_aired_at'),
        )
        .group_by(Episode.anime_id)
        .subquery()
    )
    watched_count_subquery = (
        select(
            watched_count_episode.anime_id.label('anime_id'),
            func.count(watched_count_progress.id).label('watched_episode_count'),
        )
        .join(watched_count_progress, watched_count_progress.episode_id == watched_count_episode.id)
        .where(
            watched_count_progress.user_id == user_id,
            watched_count_progress.watched.is_(True),
        )
        .group_by(watched_count_episode.anime_id)
        .subquery()
    )
    has_future_episode = exists(
        select(1).where(
            future_episode.anime_id == AnimeMetaInfo.id,
            future_episode.status != EpisodeStatus.AIRED,
        ),
    )
    tracking_condition = or_(
        has_future_episode,
        and_(
            AnimeMetaInfo.total_episodes.is_not(None),
            AnimeMetaInfo.total_episodes > episode_stats_subquery.c.imported_episode_count,
        ),
        episode_stats_subquery.c.last_aired_at >= now - timedelta(days=recent_days),
    )
    return {
        'next_episode_subquery': next_episode_subquery,
        'episode_stats_subquery': episode_stats_subquery,
        'watched_count_subquery': watched_count_subquery,
        'tracking_condition': tracking_condition,
    }
