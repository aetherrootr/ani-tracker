from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.import_provider.base import ImportProvider
from app.import_provider.types import (
    ImportAnimeName,
    ImportAnimeSummary,
    ImportEpisodeInfo,
    ImportEpisodeName,
)
from app.models.anime import (
    AnimeMetaInfo,
    AnimeName,
    AnimePoster,
    AnimeRelation,
    AnimeSummary,
    Episode,
    EpisodeName,
)
from app.models.progress import (
    UserAnimeProgress,
    UserAnimeMetadataSource,
    UserAnimeRelationDeletionPrompt,
    UserEpisodeProgress,
)
from app.models.user import User
from app.services.anime_library import create_or_update_metadata_snapshot, populate_anime_from_detail


@dataclass(frozen=True)
class EpisodeConflict:
    anime_id: int
    episode_id: int
    episode_number: int
    display_name: str | None
    watched_user_count: int
    watched: bool | None = None
    watched_at: str | None = None
    reason: str | None = None


@dataclass(frozen=True)
class AnimeSyncResult:
    anime: AnimeMetaInfo
    episode_conflicts: list[EpisodeConflict]
    poster_ids_to_enqueue: list[int]


def sync_anime_from_provider(
    session: Session,
    provider: ImportProvider,
    *,
    anime_id: int,
    user_id: int | None = None,
) -> AnimeSyncResult | None:
    anime = session.get(AnimeMetaInfo, anime_id)
    if anime is None:
        return None
    progress = None
    if user_id is not None:
        progress = session.scalar(
            select(UserAnimeProgress).where(
                UserAnimeProgress.user_id == user_id,
                UserAnimeProgress.anime_id == anime_id,
            ),
        )
        if progress is not None and progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
            return AnimeSyncResult(anime=anime, episode_conflicts=[], poster_ids_to_enqueue=[])
    user = session.get(User, user_id) if user_id is not None else None
    detail = provider.get_anime_detail(anime.external_id, language=user.language_preference if user is not None else None)
    if progress is not None and _has_destructive_episode_change(session, anime_id=anime.id, episodes=detail.episodes):
        create_or_update_metadata_snapshot(session, progress=progress)
    poster = populate_anime_from_detail(session, anime, detail)
    if user_id is not None:
        _create_related_anime_deletion_prompts(session, user_id=user_id, anime_id=anime.id)
    _prune_summaries(session, anime_id=anime.id, summaries=detail.summaries)
    _prune_names(session, anime_id=anime.id, names=detail.names, original_title=detail.original_title)
    conflicts = _prune_episodes(session, anime=anime, episodes=detail.episodes, user_id=user_id)
    poster_ids = _poster_ids_to_enqueue(session, anime_id=anime.id, poster=poster)
    return AnimeSyncResult(anime=anime, episode_conflicts=conflicts, poster_ids_to_enqueue=poster_ids)


def _has_destructive_episode_change(session: Session, *, anime_id: int, episodes: list[ImportEpisodeInfo]) -> bool:
    upstream_numbers = {item.episode_number for item in episodes}
    if not upstream_numbers:
        return session.scalar(select(func.count(Episode.id)).where(Episode.anime_id == anime_id)) != 0
    existing_numbers = set(session.scalars(select(Episode.episode_number).where(Episode.anime_id == anime_id)).all())
    return bool(existing_numbers - upstream_numbers)


def _create_related_anime_deletion_prompts(session: Session, *, user_id: int, anime_id: int) -> None:
    stale_relations = session.scalars(
        select(AnimeRelation).where(
            AnimeRelation.anime_id == anime_id,
            AnimeRelation.relation_type == 'same_series_season',
            AnimeRelation.is_active.is_(False),
        ),
    ).all()
    for relation in stale_relations:
        existing = session.scalar(
            select(UserAnimeRelationDeletionPrompt).where(
                UserAnimeRelationDeletionPrompt.user_id == user_id,
                UserAnimeRelationDeletionPrompt.anime_relation_id == relation.id,
            ),
        )
        if existing is not None:
            continue
        if relation.related_anime_id is not None and session.scalar(
            select(UserAnimeProgress.id).where(
                UserAnimeProgress.user_id == user_id,
                UserAnimeProgress.anime_id == relation.related_anime_id,
            ),
        ) is None:
            continue
        session.add(
            UserAnimeRelationDeletionPrompt(
                user_id=user_id,
                anime_id=anime_id,
                related_anime_id=relation.related_anime_id,
                anime_relation_id=relation.id,
                provider=relation.provider_type,
                external_id=relation.external_id,
                title=relation.title,
                relation_type=relation.relation_type,
                season_number=relation.season_number,
                air_date=relation.air_date,
                episode_count=relation.episode_count,
            ),
        )


def get_episode_conflicts(session: Session, *, anime_id: int, user_id: int | None = None) -> list[EpisodeConflict]:
    anime = session.get(AnimeMetaInfo, anime_id)
    if anime is None or anime.last_synced_at is None:
        return []
    episodes = session.scalars(select(Episode).where(Episode.anime_id == anime_id).order_by(Episode.episode_number)).all()
    return [_episode_conflict(session, episode, user_id=user_id) for episode in episodes if _is_orphaned_by_sync(episode, anime) and _watched_user_count(session, episode_id=episode.id) > 0]


def serialize_episode_conflict(conflict: EpisodeConflict) -> dict[str, Any]:
    data: dict[str, Any] = {
        'animeId': conflict.anime_id,
        'episodeId': conflict.episode_id,
        'episodeNumber': conflict.episode_number,
        'displayName': conflict.display_name,
        'watchedUserCount': conflict.watched_user_count,
    }
    if conflict.watched is not None:
        data['watched'] = conflict.watched
        data['watchedAt'] = conflict.watched_at
    if conflict.reason is not None:
        data['reason'] = conflict.reason
    return data


def _prune_summaries(session: Session, *, anime_id: int, summaries: list[ImportAnimeSummary]) -> None:
    languages = {item.language for item in summaries if item.summary.strip()}
    stale = session.scalars(select(AnimeSummary).where(AnimeSummary.anime_id == anime_id, AnimeSummary.language.not_in(languages))).all()
    stale_ids = [summary.id for summary in stale]
    if stale_ids:
        session.execute(update(UserAnimeProgress).where(UserAnimeProgress.preferred_summary_id.in_(stale_ids)).values(preferred_summary_id=None))
    for summary in stale:
        session.delete(summary)


def _prune_names(session: Session, *, anime_id: int, names: list[ImportAnimeName], original_title: str | None) -> None:
    values = {item.name.strip() for item in names if item.name.strip()}
    if original_title:
        values.add(original_title.strip())
    stale = session.scalars(select(AnimeName).where(AnimeName.anime_id == anime_id, AnimeName.name.not_in(values))).all()
    stale_ids = [name.id for name in stale]
    if stale_ids:
        session.execute(update(UserAnimeProgress).where(UserAnimeProgress.preferred_name_id.in_(stale_ids)).values(preferred_name_id=None))
    for name in stale:
        session.delete(name)


def _prune_episodes(
    session: Session,
    *,
    anime: AnimeMetaInfo,
    episodes: list[ImportEpisodeInfo],
    user_id: int | None,
) -> list[EpisodeConflict]:
    upstream_numbers = {item.episode_number for item in episodes}
    for item in episodes:
        episode = session.scalar(
            select(Episode).where(Episode.anime_id == anime.id, Episode.episode_number == item.episode_number),
        )
        if episode is not None:
            _prune_episode_names(session, episode=episode, names=item.names, title=item.title)
    conflicts: list[EpisodeConflict] = []
    stale_episodes = session.scalars(select(Episode).where(Episode.anime_id == anime.id, Episode.episode_number.not_in(upstream_numbers))).all()
    for episode in stale_episodes:
        watched_count = _watched_user_count(session, episode_id=episode.id)
        if watched_count > 0:
            conflicts.append(_episode_conflict(session, episode, user_id=user_id, watched_count=watched_count))
            continue
        session.delete(episode)
    return conflicts


def _prune_episode_names(
    session: Session,
    *,
    episode: Episode,
    names: list[ImportEpisodeName],
    title: str | None,
) -> None:
    values = {item.name.strip() for item in names if item.name.strip()}
    if title:
        values.add(title.strip())
    stale = session.scalars(select(EpisodeName).where(EpisodeName.episode_id == episode.id, EpisodeName.name.not_in(values))).all()
    stale_ids = [name.id for name in stale]
    if stale_ids:
        session.execute(update(UserEpisodeProgress).where(UserEpisodeProgress.preferred_name_id.in_(stale_ids)).values(preferred_name_id=None))
    for name in stale:
        session.delete(name)


def _poster_ids_to_enqueue(session: Session, *, anime_id: int, poster: AnimePoster | None) -> list[int]:
    posters: list[AnimePoster] = []
    if poster is not None:
        posters.append(poster)
    posters.extend(
        session.scalars(select(AnimePoster).where(AnimePoster.anime_id == anime_id, AnimePoster.status == 'failed')).all(),
    )
    ids: list[int] = []
    seen: set[int] = set()
    for item in posters:
        if item.status in {'pending', 'failed'} and item.id not in seen:
            item.status = 'pending'
            item.last_error = None
            ids.append(item.id)
            seen.add(item.id)
    return ids


def _watched_user_count(session: Session, *, episode_id: int) -> int:
    return session.scalar(
        select(func.count(UserEpisodeProgress.id)).where(
            UserEpisodeProgress.episode_id == episode_id,
            UserEpisodeProgress.watched.is_(True),
        ),
    ) or 0


def _episode_conflict(
    session: Session,
    episode: Episode,
    *,
    user_id: int | None,
    watched_count: int | None = None,
) -> EpisodeConflict:
    watched_progress = None
    if user_id is not None:
        watched_progress = session.scalar(
            select(UserEpisodeProgress).where(
                UserEpisodeProgress.user_id == user_id,
                UserEpisodeProgress.episode_id == episode.id,
                UserEpisodeProgress.watched.is_(True),
            ),
        )
    selected_name = session.scalar(select(EpisodeName).where(EpisodeName.episode_id == episode.id).order_by(EpisodeName.id))
    return EpisodeConflict(
        anime_id=episode.anime_id,
        episode_id=episode.id,
        episode_number=episode.episode_number,
        display_name=selected_name.name if selected_name is not None else episode.original_title,
        watched_user_count=watched_count if watched_count is not None else _watched_user_count(session, episode_id=episode.id),
        watched=watched_progress is not None if user_id is not None else None,
        watched_at=watched_progress.watched_at.isoformat() if watched_progress is not None and watched_progress.watched_at else None,
    )


def _is_orphaned_by_sync(episode: Episode, anime: AnimeMetaInfo) -> bool:
    if anime.last_synced_at is None:
        return False
    if episode.last_synced_at is None:
        return True
    return episode.last_synced_at < anime.last_synced_at
