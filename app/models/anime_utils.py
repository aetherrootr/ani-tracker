from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import and_, exists, func, not_, or_, select
from sqlalchemy.orm import Session, aliased, selectinload

from app.models.anime import AnimeMetaInfo, Episode, EpisodeStatus
from app.models.progress import UserAnimeProgress, UserAnimeStatus, UserEpisodeProgress

LIBRARY_AIRING_RECENT_DAYS = 30
AnimeAirStatus = Literal['notStarted', 'airing', 'completed']


def episode_effectively_aired_condition(episode: Any, *, now: datetime) -> Any:
    return or_(
        episode.status == EpisodeStatus.AIRED,
        and_(
            episode.status == EpisodeStatus.UPCOMING,
            episode.status_air_at.is_not(None),
            episode.status_air_at <= now,
        ),
    )


def is_episode_effectively_aired(episode: Episode, *, now: datetime | None = None) -> bool:
    if episode.status == EpisodeStatus.AIRED:
        return True
    if episode.status != EpisodeStatus.UPCOMING or episode.status_air_at is None:
        return False
    status_air_at = episode.status_air_at
    if status_air_at.tzinfo is None:
        status_air_at = status_air_at.replace(tzinfo=UTC)
    return status_air_at <= (now or datetime.now(UTC))


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
    include_unwatched_season_zero: bool = False,
) -> tuple[int, list[TrackingListQueryRow]]:
    return _get_tracking_list_rows(
        session,
        user_id=user_id,
        limit=limit,
        offset=offset,
        now=now,
        recent_days=recent_days,
        include_unwatched_season_zero=include_unwatched_season_zero,
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
    include_unwatched_season_zero: bool = False,
) -> tuple[int, list[TrackingListQueryRow]]:
    return _get_tracking_list_rows(
        session,
        user_id=user_id,
        limit=limit,
        offset=offset,
        now=now,
        recent_days=recent_days,
        include_unwatched_season_zero=include_unwatched_season_zero,
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
    now = datetime.now(UTC)
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
        .where(episode_effectively_aired_condition(Episode, now=now))
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
    include_unwatched_season_zero: bool,
    section: str,
) -> tuple[int, list[TrackingListQueryRow]]:
    selected_episode = aliased(Episode)
    query_parts = tracking_list_query_parts(user_id=user_id, now=now, recent_days=recent_days)
    section_condition = query_parts['tracking_condition'] if section == 'tracking' else ~query_parts['tracking_condition']
    conditions = [
        UserAnimeProgress.user_id == user_id,
        UserAnimeProgress.status.not_in([UserAnimeStatus.DROPPED, UserAnimeStatus.ON_HOLD]),
        section_condition,
    ]
    if not include_unwatched_season_zero:
        conditions.append(not_(season_zero_anime_condition(AnimeMetaInfo)))

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
        .where(*conditions)
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


def tracking_list_query_parts(*, user_id: int, now: datetime, recent_days: int) -> dict[str, Any]:
    next_episode = aliased(Episode)
    watched_next_progress = aliased(UserEpisodeProgress)
    future_episode = aliased(Episode)
    watched_count_episode = aliased(Episode)
    watched_count_progress = aliased(UserEpisodeProgress)
    next_episode_aired = episode_effectively_aired_condition(next_episode, now=now)
    episode_aired = episode_effectively_aired_condition(Episode, now=now)

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
            next_episode_aired,
            ~watched_next_exists,
        )
        .group_by(next_episode.anime_id)
        .subquery()
    )
    episode_stats_subquery = (
        select(
            Episode.anime_id.label('anime_id'),
            func.count(Episode.id).label('imported_episode_count'),
            func.count(Episode.id).filter(episode_aired).label('aired_episode_count'),
            func.max(Episode.air_at).filter(episode_aired).label('last_aired_at'),
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
            ~episode_effectively_aired_condition(future_episode, now=now),
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


def library_filter_conditions(*, user_id: int, now: datetime) -> dict[str, Any]:
    unwatched_episode = aliased(Episode)
    watched_progress = aliased(UserEpisodeProgress)
    aired_episode = aliased(Episode)
    active_episode = aliased(Episode)
    imported_episode = aliased(Episode)
    last_aired_episode = aliased(Episode)

    watched_exists = exists(
        select(1).where(
            watched_progress.episode_id == unwatched_episode.id,
            watched_progress.user_id == user_id,
            watched_progress.watched.is_(True),
        ),
    )
    has_unwatched_episode = exists(
        select(1).where(
            unwatched_episode.anime_id == AnimeMetaInfo.id,
            episode_effectively_aired_condition(unwatched_episode, now=now),
            ~watched_exists,
        ),
    )
    has_aired_episode = exists(
        select(1).where(
            aired_episode.anime_id == AnimeMetaInfo.id,
            episode_effectively_aired_condition(aired_episode, now=now),
        ),
    )
    has_active_episode = exists(
        select(1).where(
            active_episode.anime_id == AnimeMetaInfo.id,
            or_(
                active_episode.status == EpisodeStatus.DELAYED,
                and_(
                    active_episode.status == EpisodeStatus.UPCOMING,
                    ~episode_effectively_aired_condition(active_episode, now=now),
                ),
            ),
        ),
    )
    imported_episode_count = (
        select(func.count(imported_episode.id))
        .where(imported_episode.anime_id == AnimeMetaInfo.id)
        .scalar_subquery()
    )
    last_aired_at = (
        select(func.max(last_aired_episode.air_at))
        .where(
            last_aired_episode.anime_id == AnimeMetaInfo.id,
            episode_effectively_aired_condition(last_aired_episode, now=now),
        )
        .scalar_subquery()
    )
    # Unknown episode totals need a recency bound so old titles do not remain airing forever.
    may_have_more = or_(
        has_active_episode,
        and_(
            AnimeMetaInfo.total_episodes.is_not(None),
            AnimeMetaInfo.total_episodes > imported_episode_count,
        ),
        and_(
            AnimeMetaInfo.total_episodes.is_(None),
            last_aired_at.is_not(None),
            last_aired_at >= now - timedelta(days=LIBRARY_AIRING_RECENT_DAYS),
        ),
    )
    return {
        'has_unwatched_episode': has_unwatched_episode,
        'not_started': ~has_aired_episode,
        'airing': and_(has_aired_episode, may_have_more),
        'completed': and_(has_aired_episode, ~may_have_more),
    }


def infer_anime_air_status(anime: AnimeMetaInfo, *, now: datetime | None = None) -> AnimeAirStatus:
    effective_now = now or datetime.now(UTC)
    aired_episodes = [episode for episode in anime.episodes if is_episode_effectively_aired(episode, now=effective_now)]
    if not aired_episodes:
        return 'notStarted'
    if any(
        episode.status == EpisodeStatus.DELAYED
        or (episode.status == EpisodeStatus.UPCOMING and not is_episode_effectively_aired(episode, now=effective_now))
        for episode in anime.episodes
    ):
        return 'airing'
    if anime.total_episodes is not None and anime.total_episodes > len(anime.episodes):
        return 'airing'
    if anime.total_episodes is None:
        last_aired_at = max((episode.air_at for episode in aired_episodes if episode.air_at is not None), default=None)
        if last_aired_at is not None:
            normalized_last_aired_at = last_aired_at.replace(tzinfo=UTC) if last_aired_at.tzinfo is None else last_aired_at.astimezone(UTC)
            if normalized_last_aired_at >= effective_now - timedelta(days=LIBRARY_AIRING_RECENT_DAYS):
                return 'airing'
    return 'completed'


def season_zero_anime_condition(anime: type[AnimeMetaInfo]):  # type: ignore[no-untyped-def]
    return or_(
        and_(anime.provider_type == 'tvdb', anime.external_id.like('%:0')),
        and_(anime.provider_type == 'tmdb', anime.external_id.like('tv:%:season:0')),
    )
