from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import or_, select, tuple_
from sqlalchemy.orm import Session

from app.api.utils.parsing import LibraryOrder, LibrarySort
from app.api.utils.serializers import (
    anime_display_sort_key,
    select_anime_name_for_user,
    select_episode_name_for_user,
    serialize_anime,
    serialize_episode_with_watch_state,
    serialize_progress,
)
from app.import_provider.types import ImportSearchResult
from app.models.anime import AnimeMetaInfo, AnimeName, Episode, EpisodeStatus
from app.models.anime_utils import (
    RecentlyWatchedQueryRow,
    TrackingListQueryRow,
    get_backlog_list_rows,
    get_progresses_by_ids_with_anime,
    get_recently_watched_rows,
    get_tracking_list_rows,
    is_episode_effectively_aired,
)
from app.models.progress import UserAnimeProgress, UserAnimeStatus
from app.models.user import User
from app.services.name_keys import build_search_variants, normalize_text

TRACKING_LIST_RECENT_LIMIT = 15  # 15 Episodes in the tracking list are considered recent
TRACKING_LIST_RECENT_DAYS = 30  # 30 Days in the tracking list are considered recent


def get_search_library_markers(
    session: Session,
    *,
    user_id: int,
    results: list[ImportSearchResult],
) -> dict[tuple[str, str], tuple[int | None, UserAnimeStatus | None]]:
    keys = {(result.provider, result.external_id) for result in results}
    markers: dict[tuple[str, str], tuple[int | None, UserAnimeStatus | None]] = dict.fromkeys(keys, (None, None))
    if not keys:
        return markers

    anime_rows = session.scalars(
        select(AnimeMetaInfo).where(tuple_(AnimeMetaInfo.provider_type, AnimeMetaInfo.external_id).in_(keys)),
    ).all()
    matching = {
        (anime.provider_type, anime.external_id): anime
        for anime in anime_rows
        if (anime.provider_type, anime.external_id) in keys
    }
    for key, anime in matching.items():
        markers[key] = (anime.id, None)

    if not matching:
        return markers
    progresses = session.scalars(
        select(UserAnimeProgress).where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.anime_id.in_([anime.id for anime in matching.values()]),
        ),
    ).all()
    progress_by_anime = {progress.anime_id: progress for progress in progresses}
    for key, anime in matching.items():
        progress = progress_by_anime.get(anime.id)
        markers[key] = (anime.id, progress.status if progress is not None else None)
    return markers


def library_search_condition(keyword: str):  # type: ignore[no-untyped-def]
    terms = library_search_terms(keyword)
    patterns = [f'%{escape_like(term)}%' for term in terms if term]
    name_conditions = []
    for pattern in patterns:
        name_conditions.extend(
            [
                AnimeName.name.ilike(pattern, escape='\\'),
                AnimeName.search_key.ilike(pattern, escape='\\'),
            ],
        )
    return or_(
        *(AnimeMetaInfo.original_name.ilike(pattern, escape='\\') for pattern in patterns),
        select(AnimeName.id)
        .where(
            AnimeName.anime_id == AnimeMetaInfo.id,
            or_(*name_conditions),
        )
        .exists(),
    )


def library_search_terms(keyword: str) -> list[str]:
    return build_search_variants(keyword)


def sort_library_search_progresses(
    progresses: Sequence[UserAnimeProgress],
    *,
    keyword: str,
    sort: LibrarySort,
    order: LibraryOrder,
    user: User,
) -> list[UserAnimeProgress]:
    fallback_order = {
        progress.anime_id: index
        for index, progress in enumerate(sort_library_progresses(progresses, sort=sort, order=order, user=user))
    }
    terms = library_search_terms(keyword)
    return sorted(
        progresses,
        key=lambda progress: (library_search_rank(progress, terms, user), fallback_order[progress.anime_id]),
    )


def library_search_rank(progress: UserAnimeProgress, terms: Sequence[str], user: User) -> tuple[int, int, int]:
    anime = progress.anime
    display_name = select_anime_display_name(anime, progress, user)
    candidates = [anime.original_name, display_name]
    candidates.extend(name.name for name in anime.names)
    normalized_candidates = [normalize_text(candidate) for candidate in candidates if candidate]
    search_key_candidates = [name.search_key for name in anime.names if name.search_key]
    normalized_terms = [normalize_text(term) for term in terms if term]

    best = 99
    for term in normalized_terms:
        compact_term = term.replace(' ', '')
        for candidate in normalized_candidates:
            compact_candidate = candidate.replace(' ', '')
            if candidate == term or compact_candidate == compact_term:
                best = min(best, 0)
            elif candidate.startswith(term) or compact_candidate.startswith(compact_term):
                best = min(best, 1)
            elif term in candidate or compact_term in compact_candidate:
                best = min(best, 2)
        for candidate in search_key_candidates:
            if candidate == term:
                best = min(best, 3)
            elif candidate.startswith(term):
                best = min(best, 4)
            elif term in candidate:
                best = min(best, 5)
    return (best, len(display_name), anime.id)


def select_anime_display_name(anime: AnimeMetaInfo, progress: UserAnimeProgress, user: User) -> str:
    selected_name = select_anime_name_for_user(anime.names, progress, user)
    return selected_name.name if selected_name is not None else anime.original_name


def escape_like(value: str) -> str:
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def sort_library_progresses(
    progresses: Sequence[UserAnimeProgress],
    *,
    sort: LibrarySort,
    order: LibraryOrder,
    user: User,
) -> list[UserAnimeProgress]:
    if sort == 'name':
        return sorted(
            progresses,
            key=lambda progress: (anime_display_sort_key(progress.anime, progress, user)[0], progress.anime_id),
            reverse=order == 'desc',
        )
    if sort == 'air_date':
        return sorted(
            progresses,
            key=lambda progress: nullable_ordinal_sort_key(progress.anime.air_date, progress.anime_id, order=order),
        )
    return sorted(
        progresses,
        key=lambda progress: nullable_timestamp_sort_key(progress.created_at, progress.anime_id, order=order),
    )


def nullable_ordinal_sort_key(value: date | None, fallback_id: int, *, order: LibraryOrder) -> tuple[bool, int, int]:
    if value is None:
        return True, 0, fallback_id
    ordinal = value.toordinal()
    return False, ordinal if order == 'asc' else -ordinal, fallback_id


def nullable_timestamp_sort_key(
    value: datetime | None,
    fallback_id: int,
    *,
    order: LibraryOrder,
) -> tuple[bool, float, int]:
    if value is None:
        return True, 0, fallback_id
    timestamp = value.timestamp()
    return False, timestamp if order == 'asc' else -timestamp, fallback_id


def build_navigation_anchors(
    progresses: list[UserAnimeProgress],
    *,
    sort: LibrarySort,
    limit: int,
    user: User,
) -> list[dict[str, int | str]]:
    if sort not in {'name', 'air_date'}:
        return []
    anchors: list[dict[str, int | str]] = []
    seen: set[str] = set()
    for index, progress in enumerate(progresses):
        if sort == 'name':
            _sort_key, initial_key = anime_display_sort_key(progress.anime, progress, user)
            key = initial_key if initial_key and initial_key.isalpha() else '#'
            label = key.upper() if key != '#' else '#'
        else:
            if progress.anime.air_date is None:
                key = 'unknown'
                label = 'Unknown'
            else:
                key = progress.anime.air_date.strftime('%Y-%m')
                label = key
        if key in seen:
            continue
        seen.add(key)
        anchors.append({'key': key, 'label': label, 'offset': index, 'page': index // limit + 1})
    return anchors


def serialize_tracking_list_item(
    *,
    anime: AnimeMetaInfo,
    progress: UserAnimeProgress,
    episode: Episode,
    watched: bool,
    watched_at: datetime | None,
    watched_episode_count: int,
    aired_episode_count: int,
    user: User,
) -> dict[str, object]:
    selected_name = select_episode_name_for_user(
        sorted(episode.names, key=lambda item: item.id),
        user,
    )
    effective_status = EpisodeStatus.AIRED if is_episode_effectively_aired(episode) else episode.status
    return {
        'anime': serialize_anime(anime, progress, user),
        'progress': serialize_progress(progress),
        'episode': serialize_episode_with_watch_state(
            {
                'episode_id': episode.id,
                'episode_number': episode.episode_number,
                'original_title': episode.original_title,
                'air_at': episode.air_at,
                'air_at_has_time': episode.air_at_has_time,
                'duration': episode.duration,
                'status': effective_status,
                'watched': watched,
                'watched_at': watched_at,
            },
            selected_name=selected_name,
        ),
        'watchedEpisodeCount': watched_episode_count,
        'airedEpisodeCount': aired_episode_count,
        'totalEpisodeCount': anime.total_episodes or len(anime.episodes) or None,
    }


def serialize_tracking_rows(
    session: Session,
    user: User,
    rows: Sequence[TrackingListQueryRow | RecentlyWatchedQueryRow],
    *,
    watched: bool,
) -> list[dict[str, object]]:
    progress_by_id = get_progresses_by_ids_with_anime(session, [row.progress_id for row in rows])
    items = []
    for row in rows:
        progress = progress_by_id[row.progress_id]
        episode = next(episode for episode in progress.anime.episodes if episode.id == row.episode_id)
        items.append(
            serialize_tracking_list_item(
                anime=progress.anime,
                progress=progress,
                episode=episode,
                watched=watched,
                watched_at=getattr(row, 'watched_at', None),
                watched_episode_count=row.watched_episode_count,
                aired_episode_count=row.aired_episode_count,
                user=user,
            ),
        )
    return items


def tracking_list_page_response(items: list[dict[str, object]], *, total: int, limit: int, offset: int) -> dict[str, object]:
    return {
        'items': items,
        'total': total,
        'limit': limit,
        'offset': offset,
        'hasMore': offset + limit < total,
    }


def tracking_list_tracking_page(session: Session, user: User, *, limit: int, offset: int) -> dict[str, object]:
    total, rows = get_tracking_list_rows(
        session,
        user_id=user.id,
        limit=limit,
        offset=offset,
        now=datetime.now(UTC),
        recent_days=TRACKING_LIST_RECENT_DAYS,
        include_unwatched_season_zero=user.include_unwatched_season_zero_in_tracking,
    )
    return tracking_list_page_response(
        serialize_tracking_rows(session, user, rows, watched=False),
        total=total,
        limit=limit,
        offset=offset,
    )


def tracking_list_backlog_page(session: Session, user: User, *, limit: int, offset: int) -> dict[str, object]:
    total, rows = get_backlog_list_rows(
        session,
        user_id=user.id,
        limit=limit,
        offset=offset,
        now=datetime.now(UTC),
        recent_days=TRACKING_LIST_RECENT_DAYS,
        include_unwatched_season_zero=user.include_unwatched_season_zero_in_tracking,
    )
    return tracking_list_page_response(
        serialize_tracking_rows(session, user, rows, watched=False),
        total=total,
        limit=limit,
        offset=offset,
    )


def tracking_list_recently_watched_page(session: Session, user: User, *, limit: int, offset: int) -> dict[str, object]:
    total, rows = get_recently_watched_rows(session, user_id=user.id, limit=limit, offset=offset)
    return tracking_list_page_response(
        serialize_tracking_rows(session, user, rows, watched=True),
        total=total,
        limit=limit,
        offset=offset,
    )


def as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def is_tracking_anime(anime: AnimeMetaInfo, *, now: datetime) -> bool:
    has_future_episode = any(not is_episode_effectively_aired(episode, now=now) for episode in anime.episodes)
    has_missing_imported_episodes = anime.total_episodes is not None and anime.total_episodes > len(anime.episodes)
    aired_times = [
        air_at
        for episode in anime.episodes
        if is_episode_effectively_aired(episode, now=now) and (air_at := as_aware_utc(episode.air_at)) is not None
    ]
    last_aired_at = max(aired_times, default=None)
    is_recently_finished = last_aired_at is not None and last_aired_at >= now - timedelta(days=TRACKING_LIST_RECENT_DAYS)
    return has_future_episode or has_missing_imported_episodes or is_recently_finished


def desc_nullable_datetime_sort_value(value: datetime | None) -> tuple[bool, float]:
    aware = as_aware_utc(value)
    if aware is None:
        return True, 0
    return False, -aware.timestamp()


def desc_nullable_date_sort_value(value: date | None) -> tuple[bool, int]:
    if value is None:
        return True, 0
    return False, -value.toordinal()
