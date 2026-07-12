from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from app.import_provider.types import ImportSearchResult
from app.models.anime import (
    AnimeMetaInfo,
    AnimeName,
    AnimePoster,
    AnimeRelation,
    AnimeSummary,
    EpisodeName,
)
from app.models.progress import UserAnimeProgress, UserAnimeStatus
from app.models.user import User
from app.services.anime_library import DuplicateAnimeCandidate
from app.services.name_keys import build_name_keys


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


def serialize_duplicate_anime_candidate(candidate: DuplicateAnimeCandidate) -> dict[str, Any]:
    anime = candidate.anime
    return {
        'animeId': anime.id,
        'provider': anime.provider_type,
        'externalId': anime.external_id,
        'displayName': anime.original_name,
        'originalName': anime.original_name,
        'airDate': anime.air_date.isoformat() if anime.air_date is not None else None,
        'episodeCount': anime.total_episodes,
        'url': anime.url,
    }


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
        'url': f'/api/anime/{poster.anime_id}/assets/poster{version}'
        if current_url
        else f'/api/anime/{poster.anime_id}/assets/posters/{poster.id}{version}',
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
    include_related_anime: bool = False,
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
    if include_related_anime:
        data['relatedAnime'] = [serialize_related_anime(item) for item in sorted(anime.related_anime, key=lambda item: (item.season_number is None, item.season_number or 0, item.id))]
    return data


def serialize_related_anime(relation: AnimeRelation) -> dict[str, Any]:
    poster_url = relation.poster_source_url
    if relation.poster is not None:
        version = f'?v={relation.poster.id}-{relation.poster.status}'
        poster_url = f'/api/anime/{relation.poster.anime_id}/assets/posters/{relation.poster.id}{version}'
    return {
        'provider': relation.provider_type,
        'externalId': relation.external_id,
        'animeId': relation.related_anime_id,
        'inLibrary': relation.related_anime_id is not None,
        'title': relation.title,
        'relationType': relation.relation_type,
        'seasonNumber': relation.season_number,
        'airDate': relation.air_date.isoformat() if relation.air_date is not None else None,
        'episodeCount': relation.episode_count,
        'url': relation.url,
        'posterUrl': poster_url,
    }


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
