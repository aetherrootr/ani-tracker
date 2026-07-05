from __future__ import annotations

from dataclasses import asdict
from typing import Any

from flask import current_app
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.import_provider.factory import ImportProviderFactory
from app.import_provider.types import ImportSearchResult
from app.models.anime import AnimeMetaInfo, AnimeName, AnimePoster, AnimeSummary, EpisodeName
from app.models.progress import UserAnimeProgress, UserAnimeStatus
from app.models.user import User


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


def select_summary_for_user(
    summaries: list[AnimeSummary],
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
    poster: AnimePoster | None,
    progress: UserAnimeProgress,
) -> AnimePoster | None:
    if poster is None:
        return None
    if progress.preferred_poster_id is None:
        return poster
    if progress.preferred_poster_id == poster.id:
        return poster
    return None


def serialize_poster(poster: AnimePoster | None, progress: UserAnimeProgress) -> dict[str, Any] | None:
    if poster is None:
        return None
    return {
        'id': poster.id,
        'status': poster.status,
        'url': f'/api/anime/library/{poster.anime_id}/poster',
        'isPreferred': progress.preferred_poster_id == poster.id,
    }


def select_anime_name_for_user(
    names: list[AnimeName],
    user: User,
) -> AnimeName | None:
    preferred_languages = [user.language_preference]
    if '-' in user.language_preference:
        preferred_languages.append(user.language_preference.split('-', 1)[0])
    for language in preferred_languages:
        for name in names:
            if name.language == language:
                return name
    return names[0] if names else None


def select_episode_name_for_user(
    names: list[EpisodeName],
    user: User,
) -> EpisodeName | None:
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
) -> dict[str, Any]:
    summaries = sorted(anime.summaries, key=lambda item: item.id)
    selected_name = select_anime_name_for_user(sorted(anime.names, key=lambda item: item.id), user)
    selected_summary = select_summary_for_user(summaries, progress, user)
    selected_poster = select_poster_for_user(anime.poster, progress)
    poster_status = selected_poster.status if selected_poster is not None else None
    data: dict[str, Any] = {
        'id': anime.id,
        'name': serialize_anime_name(selected_name),
        'displayName': selected_name.name if selected_name is not None else anime.original_name,
        'originalName': anime.original_name,
        'summary': serialize_summary(selected_summary, progress),
        'posterUrl': f'/api/anime/library/{anime.id}/poster' if selected_poster is not None else None,
        'poster': serialize_poster(selected_poster, progress),
        'preferredPosterId': progress.preferred_poster_id,
        'posterStatus': poster_status,
        'type': anime.type.value,
        'totalEpisodes': anime.total_episodes,
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
    return data


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
