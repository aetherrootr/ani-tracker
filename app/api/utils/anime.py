from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

from flask import current_app, jsonify, send_file
from flask.typing import ResponseReturnValue
from sqlalchemy import or_, select, tuple_
from sqlalchemy.orm import Session

from app.import_provider.factory import ImportProviderFactory
from app.import_provider.types import ImportSearchResult
from app.models.anime import AnimeMetaInfo, AnimeName, AnimePoster, AnimeSummary, EpisodeName
from app.models.progress import UserAnimeProgress, UserAnimeStatus
from app.models.user import User
from app.services.anime_poster import resolve_poster_path
from app.services.name_keys import build_name_keys, build_search_key, normalize_text

LibrarySort = Literal['updated_at', 'name', 'air_date']
LibraryOrder = Literal['asc', 'desc']

_LIBRARY_SORT_ALIASES: dict[str, LibrarySort] = {
    'updated_at': 'updated_at',
    'updatedAt': 'updated_at',
    'name': 'name',
    'air_date': 'air_date',
    'airDate': 'air_date',
}


def parse_search_limit(value: str | None) -> tuple[int, str | None]:
    if value is None:
        return 20, None
    try:
        limit = int(value)
    except ValueError:
        return 0, 'Search limit is invalid'
    if limit < 1 or limit > 50:
        return 0, 'Search limit is invalid'
    return limit, None


def parse_search_offset(value: str | None) -> tuple[int, str | None]:
    if value is None:
        return 0, None
    try:
        offset = int(value)
    except ValueError:
        return 0, 'Search offset is invalid'
    if offset < 0:
        return 0, 'Search offset is invalid'
    return offset, None


def get_import_provider_factory() -> ImportProviderFactory:
    factory = current_app.extensions['import_provider_factory']
    if not isinstance(factory, ImportProviderFactory):
        message = 'Import provider factory is not initialized'
        raise RuntimeError(message)
    return factory


def serialize_import_search_result(
    result: ImportSearchResult,
    *,
    anime_id: int | None = None,
    library_status: UserAnimeStatus | None = None,
) -> dict[str, Any]:
    data = asdict(result)
    return {
        'provider': data['provider'],
        'externalId': data['external_id'],
        'title': data['title'],
        'originalTitle': data['original_title'],
        'summary': data['summary'],
        'airDate': data['air_date'],
        'platform': data['platform'],
        'episodeCount': data['episode_count'],
        'imageUrl': data['image_url'],
        'url': data['url'],
        'rawData': data['raw_data'],
        'inLibrary': library_status is not None,
        'animeId': anime_id,
        'libraryStatus': library_status.value if library_status is not None else None,
    }


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


def parse_library_limit(value: str | None, *, default: int = 20, maximum: int = 500) -> tuple[int, str | None]:
    if value is None:
        return default, None
    try:
        limit = int(value)
    except ValueError:
        return 0, 'Pagination limit is invalid'
    if limit < 1 or limit > maximum:
        return 0, 'Pagination limit is invalid'
    return limit, None


def parse_library_offset(value: str | None) -> tuple[int, str | None]:
    if value is None:
        return 0, None
    try:
        offset = int(value)
    except ValueError:
        return 0, 'Pagination offset is invalid'
    if offset < 0:
        return 0, 'Pagination offset is invalid'
    return offset, None


def parse_library_status(value: str | None) -> tuple[UserAnimeStatus | None, str | None]:
    if value is None or value == '' or value == 'all':
        return None, None
    try:
        status = UserAnimeStatus(value)
    except ValueError:
        return None, 'Library status is invalid'
    if status == UserAnimeStatus.DROPPED:
        return None, 'Library status is invalid'
    return status, None


def parse_library_sort(value: str | None) -> tuple[LibrarySort, str | None]:
    if value is None or value == '':
        return 'updated_at', None
    sort = _LIBRARY_SORT_ALIASES.get(value)
    if sort is None:
        return 'updated_at', 'Library sort is invalid'
    return sort, None


def parse_library_order(value: str | None) -> tuple[LibraryOrder, str | None]:
    if value is None or value == '':
        return 'desc', None
    if value not in {'asc', 'desc'}:
        return 'desc', 'Library order is invalid'
    return value, None  # type: ignore[return-value]


def library_search_condition(keyword: str):  # type: ignore[no-untyped-def]
    terms = {keyword.strip(), normalize_text(keyword)}
    terms.update(build_search_key(keyword).split())
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


def total_pages(total: int, limit: int) -> int:
    return math.ceil(total / limit) if total > 0 else 0


def select_summary_for_user(
    summaries: Sequence[AnimeSummary],
    progress: UserAnimeProgress,
    user: User,
) -> AnimeSummary | None:
    if progress.preferred_summary_id is not None:
        for summary in summaries:
            if summary.id == progress.preferred_summary_id:
                return summary
    preferred_languages = [user.language_preference]
    if '-' in user.language_preference:
        preferred_languages.append(user.language_preference.split('-', 1)[0])
    for language in preferred_languages:
        for summary in summaries:
            if summary.language == language:
                return summary
    return summaries[0] if summaries else None


def select_poster_for_user(
    posters: Sequence[AnimePoster],
    progress: UserAnimeProgress,
) -> AnimePoster | None:
    if not posters:
        return None
    if progress.preferred_poster_id is not None:
        for poster in posters:
            if progress.preferred_poster_id == poster.id:
                return poster
    return min(posters, key=lambda item: (item.status != 'ready', item.id))


def serialize_poster(
    poster: AnimePoster | None,
    progress: UserAnimeProgress,
    *,
    current_url: bool = True,
) -> dict[str, Any] | None:
    if poster is None:
        return None
    version = f'?v={poster.id}-{poster.status}'
    return {
        'id': poster.id,
        'status': poster.status,
        'url': f'/api/anime/library/{poster.anime_id}/poster{version}'
        if current_url
        else f'/api/anime/library/{poster.anime_id}/posters/{poster.id}{version}',
        'isPreferred': progress.preferred_poster_id == poster.id,
    }


def select_anime_name_for_user(
    names: Sequence[AnimeName],
    progress: UserAnimeProgress,
    user: User,
) -> AnimeName | None:
    if progress.preferred_name_id is not None:
        for name in names:
            if name.id == progress.preferred_name_id:
                return name
    preferred_languages = [user.language_preference]
    if '-' in user.language_preference:
        preferred_languages.append(user.language_preference.split('-', 1)[0])
    for language in preferred_languages:
        for name in names:
            if name.language == language:
                return name
    return names[0] if names else None


def select_episode_name_for_user(
    names: Sequence[EpisodeName],
    user: User,
    *,
    preferred_name_id: int | None = None,
) -> EpisodeName | None:
    if preferred_name_id is not None:
        for name in names:
            if name.id == preferred_name_id:
                return name
    preferred_languages = [user.language_preference]
    if '-' in user.language_preference:
        preferred_languages.append(user.language_preference.split('-', 1)[0])
    for language in preferred_languages:
        for name in names:
            if name.language == language:
                return name
    return names[0] if names else None


def serialize_summary(summary: AnimeSummary | None, progress: UserAnimeProgress) -> dict[str, Any] | None:
    if summary is None:
        return None
    return {
        'id': summary.id,
        'language': summary.language,
        'summary': summary.summary,
        'isPreferred': progress.preferred_summary_id == summary.id,
    }


def serialize_anime_name(name: AnimeName | None) -> dict[str, Any] | None:
    if name is None:
        return None
    return {'id': name.id, 'language': name.language, 'name': name.name}


def serialize_progress(progress: UserAnimeProgress, *, include_anime_id: bool = False) -> dict[str, Any]:
    data = {
        'id': progress.id,
        'status': progress.status.value,
        'lastWatchedEpisodeNumber': progress.last_watched_episode_number,
        'lastWatchedAt': progress.last_watched_at.isoformat() if progress.last_watched_at is not None else None,
        'preferredNameId': progress.preferred_name_id,
        'preferredSummaryId': progress.preferred_summary_id,
        'preferredPosterId': progress.preferred_poster_id,
    }
    if include_anime_id:
        data['animeId'] = progress.anime_id
    return data


def serialize_library_progress(
    progress: UserAnimeProgress,
    *,
    watched_episode_count: int,
    total_episode_count: int | None,
) -> dict[str, Any]:
    data = serialize_progress(progress)
    data['watchedEpisodeCount'] = watched_episode_count
    data['totalEpisodeCount'] = total_episode_count
    if total_episode_count and total_episode_count > 0:
        data['progressPercent'] = round(watched_episode_count / total_episode_count * 100, 2)
    else:
        data['progressPercent'] = None
    return data


def serialize_anime(
    anime: AnimeMetaInfo,
    progress: UserAnimeProgress,
    user: User,
    *,
    include_available_summaries: bool = False,
    include_available_names: bool = False,
    include_available_posters: bool = False,
) -> dict[str, Any]:
    summaries = sorted(anime.summaries, key=lambda item: item.id)
    names = sorted(anime.names, key=lambda item: item.id)
    posters = sorted(anime.posters, key=lambda item: item.id)
    selected_name = select_anime_name_for_user(names, progress, user)
    selected_summary = select_summary_for_user(summaries, progress, user)
    selected_poster = select_poster_for_user(posters, progress)
    serialized_poster = serialize_poster(selected_poster, progress)
    poster_status = selected_poster.status if selected_poster is not None else None
    data: dict[str, Any] = {
        'id': anime.id,
        'name': serialize_anime_name(selected_name),
        'displayName': selected_name.name if selected_name is not None else anime.original_name,
        'originalName': anime.original_name,
        'summary': serialize_summary(selected_summary, progress),
        'posterUrl': serialized_poster['url'] if serialized_poster is not None else None,
        'poster': serialized_poster,
        'preferredNameId': progress.preferred_name_id,
        'preferredPosterId': progress.preferred_poster_id,
        'posterStatus': poster_status,
        'type': anime.type.value,
        'totalEpisodes': anime.total_episodes,
        'airDate': anime.air_date.isoformat() if anime.air_date is not None else None,
        'lastSyncedAt': anime.last_synced_at.isoformat() if anime.last_synced_at is not None else None,
        'provider': anime.provider_type,
        'externalId': anime.external_id,
        'url': anime.url,
        'episodeCount': len(anime.episodes),
    }
    if include_available_summaries:
        data['availableSummaries'] = [
            {'id': summary.id, 'language': summary.language, 'summary': summary.summary}
            for summary in summaries
        ]
    if include_available_names:
        data['availableNames'] = [serialize_anime_name(name) for name in names]
    if include_available_posters:
        data['availablePosters'] = [
            serialize_poster(poster, progress, current_url=False)
            for poster in posters
        ]
    return data


def anime_display_sort_key(anime: AnimeMetaInfo, progress: UserAnimeProgress, user: User) -> tuple[str, str]:
    selected_name = select_anime_name_for_user(sorted(anime.names, key=lambda item: item.id), progress, user)
    if selected_name is not None:
        return selected_name.sort_key, selected_name.initial_key
    sort_key, initial_key, _search_key = build_name_keys(anime.original_name)
    return sort_key, initial_key


def serialize_episode_name(name: EpisodeName | None) -> dict[str, Any] | None:
    if name is None:
        return None
    return {'id': name.id, 'language': name.language, 'name': name.name}


def serialize_episode_with_watch_state(
    row: dict[str, Any],
    *,
    selected_name: EpisodeName | None = None,
) -> dict[str, Any]:
    status = row['status']
    return {
        'id': row['episode_id'],
        'episodeNumber': row['episode_number'],
        'name': serialize_episode_name(selected_name),
        'displayName': selected_name.name if selected_name is not None else row['original_title'],
        'originalTitle': row['original_title'],
        'airAt': row['air_at'].isoformat() if row['air_at'] is not None else None,
        'duration': row['duration'],
        'status': status.value if hasattr(status, 'value') else status,
        'watched': bool(row['watched']),
        'watchedAt': row['watched_at'].isoformat() if row['watched_at'] is not None else None,
    }


def send_poster_file(poster: AnimePoster | None) -> ResponseReturnValue:
    if poster is None or poster.status != 'ready':
        return jsonify({'message': 'Poster not found'}), 404
    path = resolve_poster_path(str(current_app.config['ANIME_POSTER_STORAGE_DIR']), poster.storage_path)
    if path is None or not Path(path).is_file():
        return jsonify({'message': 'Poster not found'}), 404
    response = send_file(path, mimetype=poster.mime_type)
    response.headers['Cache-Control'] = 'public, max-age=86400'
    return response
