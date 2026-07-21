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
    AnimeRelationTitle,
    AnimeSummary,
    EpisodeName,
)
from app.models.anime_utils import infer_anime_air_status
from app.models.progress import (
    UserAnimeMetadataEpisodeSnapshot,
    UserAnimeMetadataSnapshot,
    UserAnimeProgress,
    UserAnimeStatus,
)
from app.models.user import User
from app.services.anime_library import DuplicateAnimeCandidate
from app.services.name_keys import build_name_keys


def language_preference_codes(language_preference: str) -> list[str]:
    preference = language_preference.lower()
    if preference.startswith('zh'):
        if preference in {'zh-tw', 'zh-hant'}:
            return [preference, 'zhtw', 'zh', 'zho']
        return [preference, 'zho', 'zh', 'zhtw']
    if preference.startswith('en'):
        return [preference, 'en', 'eng']
    if preference.startswith('ja'):
        return [preference, 'ja', 'jpn']
    return list(dict.fromkeys([preference, preference.split('-', 1)[0]]))


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
    for language in language_preference_codes(user.language_preference):
        for summary in summaries:
            if summary.language.lower() == language:
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
    for language in language_preference_codes(user.language_preference):
        for name in names:
            if name.language is not None and name.language.lower() == language:
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
    preferred_languages = language_preference_codes(user.language_preference)
    for language in dict.fromkeys([*preferred_languages, 'en', 'eng']):
        for name in names:
            if name.language is not None and name.language.lower() == language:
                return name
    return None


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


def serialize_progress(progress: UserAnimeProgress, *, include_anime_id: bool = False, has_local_snapshot: bool | None = None) -> dict[str, Any]:
    data = {
        'id': progress.id,
        'status': progress.status.value,
        'lastWatchedEpisodeNumber': progress.last_watched_episode_number,
        'lastWatchedAt': progress.last_watched_at.isoformat() if progress.last_watched_at is not None else None,
        'preferredNameId': progress.preferred_name_id,
        'preferredSummaryId': progress.preferred_summary_id,
        'preferredPosterId': progress.preferred_poster_id,
        'metadataSource': progress.metadata_source,
        'hasLocalSnapshot': (progress.metadata_snapshot_id is not None) if has_local_snapshot is None else has_local_snapshot,
    }
    if include_anime_id:
        data['animeId'] = progress.anime_id
    return data


def serialize_metadata_snapshot(snapshot: UserAnimeMetadataSnapshot | None, *, include_episodes: bool = False) -> dict[str, Any] | None:
    if snapshot is None:
        return None
    data: dict[str, Any] = {
        'id': snapshot.id,
        'sourceAnimeId': snapshot.source_anime_id,
        'sourceProvider': snapshot.source_provider,
        'sourceExternalId': snapshot.source_external_id,
        'sourceTitle': snapshot.source_title,
        'episodeCount': snapshot.episode_count,
        'createdAt': snapshot.created_at.isoformat(),
        'updatedAt': snapshot.updated_at.isoformat(),
    }
    if include_episodes:
        data['episodes'] = [serialize_metadata_snapshot_episode(episode) for episode in sorted(snapshot.episodes, key=lambda item: item.episode_number)]
    return data


def serialize_metadata_snapshot_episode(episode: UserAnimeMetadataEpisodeSnapshot) -> dict[str, Any]:
    return {
        'id': episode.id,
        'episodeNumber': episode.episode_number,
        'displayName': episode.title,
        'airAt': episode.air_at.isoformat() if episode.air_at is not None else None,
        'airAtPrecision': None if episode.air_at is None else ('datetime' if episode.air_at_has_time else 'date'),
        'duration': episode.duration,
        'status': episode.status,
        'watched': episode.watched,
        'watchedAt': episode.watched_at.isoformat() if episode.watched_at is not None else None,
    }


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
    related_library_anime_ids: set[int] | None = None,
    related_anime_overrides: dict[int, AnimeMetaInfo] | None = None,
    related_anime_override_provider_import: dict[int, bool] | None = None,
    related_anime_progresses: dict[int, UserAnimeProgress] | None = None,
    related_anime_items: list[dict[str, Any]] | None = None,
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
        'airStatus': infer_anime_air_status(anime),
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
        if related_anime_items is not None:
            data['relatedAnime'] = related_anime_items
        else:
            data['relatedAnime'] = [
                serialize_related_anime(
                    item,
                    user=user,
                    library_anime_ids=related_library_anime_ids,
                    override_anime=(related_anime_overrides or {}).get(item.id),
                    allow_provider_import=(related_anime_override_provider_import or {}).get(item.id),
                    related_anime_progresses=related_anime_progresses,
                )
                for item in sorted(anime.related_anime, key=lambda item: (item.season_number is None, item.season_number or 0, item.id))
                if item.is_active
            ]
    return data


def serialize_related_anime(
    relation: AnimeRelation,
    *,
    user: User,
    library_anime_ids: set[int] | None = None,
    override_anime: AnimeMetaInfo | None = None,
    allow_provider_import: bool | None = None,
    related_anime_progresses: dict[int, UserAnimeProgress] | None = None,
    source: str = 'provider',
    pending_upstream_deletion: bool = False,
) -> dict[str, Any]:
    related_anime_id = relation.related_anime_id
    poster_url = relation.poster_source_url
    if override_anime is not None:
        related_anime_id = override_anime.id
        poster = min(override_anime.posters, key=lambda item: (item.status != 'ready', item.id), default=None)
        if poster is not None:
            version = f'?v={poster.id}-{poster.status}'
            poster_url = f'/api/anime/{poster.anime_id}/assets/posters/{poster.id}{version}'
    elif relation.poster is not None:
        version = f'?v={relation.poster.id}-{relation.poster.status}'
        poster_url = f'/api/anime/{relation.poster.anime_id}/assets/posters/{relation.poster.id}{version}'
    in_library = related_anime_id is not None
    if library_anime_ids is not None:
        in_library = related_anime_id in library_anime_ids
    title = select_anime_relation_title_for_user(relation.titles, user) or relation.title
    related_progress = (related_anime_progresses or {}).get(related_anime_id) if related_anime_id is not None else None
    mapped_anime = related_progress.anime if related_progress is not None else override_anime or relation.related_anime
    if related_progress is not None:
        selected_name = select_anime_name_for_user(sorted(related_progress.anime.names, key=lambda item: item.id), related_progress, user)
        title = selected_name.name if selected_name is not None else related_progress.anime.original_name
    air_date = mapped_anime.air_date if mapped_anime is not None and mapped_anime.air_date is not None else relation.air_date
    episode_count = mapped_anime.total_episodes if mapped_anime is not None and mapped_anime.total_episodes is not None else relation.episode_count
    data = {
        'provider': relation.provider_type,
        'externalId': relation.external_id,
        'animeId': related_anime_id,
        'inLibrary': in_library,
        'title': title,
        'relationType': relation.relation_type,
        'seasonNumber': relation.season_number,
        'airDate': air_date.isoformat() if air_date is not None else None,
        'episodeCount': episode_count,
        'url': relation.url,
        'posterUrl': poster_url,
        'source': source,
        'mappedByOverride': override_anime is not None,
        'needsManualMapping': related_anime_id is None or not in_library,
        'pendingUpstreamDeletion': pending_upstream_deletion,
        'relationId': relation.id,
        'manualRelationId': None,
        'allowProviderImport': allow_provider_import,
    }
    return data


def select_anime_relation_title_for_user(
    titles: Sequence[AnimeRelationTitle],
    user: User,
) -> str | None:
    for language in language_preference_codes(user.language_preference):
        for title in titles:
            if title.language.lower() == language:
                return title.title
    fallback = next((title for title in titles if title.language.lower() == 'und'), None)
    return fallback.title if fallback is not None else None


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
        'airAtPrecision': None if row['air_at'] is None else ('datetime' if row['air_at_has_time'] else 'date'),
        'duration': row['duration'],
        'status': status.value if hasattr(status, 'value') else status,
        'watched': bool(row['watched']),
        'watchedAt': row['watched_at'].isoformat() if row['watched_at'] is not None else None,
    }
