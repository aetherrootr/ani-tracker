from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.import_provider.base import ImportProvider
from app.import_provider.types import (
    ImportAnimeDetail,
    ImportAnimeName,
    ImportAnimeSummary,
    ImportEpisodeInfo,
    ImportEpisodeName,
    ImportRelatedAnime,
)
from app.models.anime import (
    AnimeMetaInfo,
    AnimeName,
    AnimePoster,
    AnimeRelation,
    AnimeSummary,
    AnimeType,
    Episode,
    EpisodeName,
    EpisodeStatus,
)
from app.models.progress import (
    UserAnimeMetadataEpisodeSnapshot,
    UserAnimeMetadataSnapshot,
    UserAnimeMetadataSource,
    UserAnimeProgress,
    UserAnimeRelationDeletionPrompt,
    UserAnimeRelationOverride,
    UserAnimeStatus,
    UserEpisodeProgress,
    UserManualAnimeRelation,
)
from app.models.user import User
from app.services.anime_poster import enqueue_poster_download, upsert_poster_record


@dataclass(frozen=True)
class DuplicateAnimeCandidate:
    anime: AnimeMetaInfo


@dataclass(frozen=True)
class DuplicateAnimeConflict(Exception):
    provider: str
    external_id: str
    title: str
    candidates: list[DuplicateAnimeCandidate]


@dataclass(frozen=True)
class ProviderSwitchResult:
    anime: AnimeMetaInfo
    progress: UserAnimeProgress
    previous_anime_id: int
    episode_conflicts: list[Any]
    related_auto_mapped_count: int
    related_manual_mapping_required_count: int


@dataclass(frozen=True)
class ProviderSwitchRelatedAnimeResult:
    auto_mapped_count: int
    manual_mapping_required_count: int


def import_anime_from_provider(
    session: Session,
    provider: ImportProvider,
    *,
    external_id: str,
    language: str | None = None,
) -> tuple[AnimeMetaInfo, bool]:
    anime = session.scalar(
        select(AnimeMetaInfo).where(
            AnimeMetaInfo.provider_type == provider.name,
            AnimeMetaInfo.external_id == external_id,
        ),
    )
    if anime is not None:
        return anime, False

    detail = provider.get_anime_detail(external_id, language=language)
    anime = AnimeMetaInfo(
        provider_type=detail.provider,
        external_id=detail.external_id,
        original_name=detail.title,
    )
    session.add(anime)
    session.flush()
    populate_anime_from_detail(session, anime, detail)

    return anime, True


def _get_or_import_anime_from_detail(
    session: Session,
    detail: ImportAnimeDetail,
) -> tuple[AnimeMetaInfo, bool]:
    anime = session.scalar(
        select(AnimeMetaInfo).where(
            AnimeMetaInfo.provider_type == detail.provider,
            AnimeMetaInfo.external_id == detail.external_id,
        ),
    )
    if anime is not None:
        return anime, False

    anime = AnimeMetaInfo(
        provider_type=detail.provider,
        external_id=detail.external_id,
        original_name=detail.title,
    )
    session.add(anime)
    session.flush()
    populate_anime_from_detail(session, anime, detail)
    return anime, True


def find_cross_provider_name_conflicts(
    session: Session,
    provider_name: str,
    detail: ImportAnimeDetail,
) -> list[DuplicateAnimeCandidate]:
    names = {_normalize_duplicate_name(name) for name in _detail_duplicate_names(detail)}
    names.discard('')
    if not names:
        return []
    candidate_anime = session.scalars(
        select(AnimeMetaInfo)
        .where(AnimeMetaInfo.provider_type != provider_name)
        .order_by(AnimeMetaInfo.id),
    ).all()
    candidate_ids = [anime.id for anime in candidate_anime]
    aliases_by_anime_id: dict[int, set[str]] = {anime.id: set() for anime in candidate_anime}
    if candidate_ids:
        for anime_id, name in session.execute(
            select(AnimeName.anime_id, AnimeName.name).where(AnimeName.anime_id.in_(candidate_ids)),
        ).all():
            aliases_by_anime_id.setdefault(anime_id, set()).add(_normalize_duplicate_name(name))
    return [
        DuplicateAnimeCandidate(anime=anime)
        for anime in candidate_anime
        if _normalize_duplicate_name(anime.original_name) in names
        or bool(aliases_by_anime_id.get(anime.id, set()) & names)
    ]


def populate_anime_from_detail(session: Session, anime: AnimeMetaInfo, detail: Any) -> AnimePoster | None:
    now = datetime.now(UTC)
    anime.url = detail.url
    anime.original_name = detail.title
    anime.type = _anime_type(detail.anime_type)
    anime.total_episodes = detail.total_episodes
    anime.air_date = detail.air_date or _first_episode_air_date(detail.episodes)
    anime.last_synced_at = now
    _upsert_summaries(session, anime, detail.summaries)
    _upsert_names(session, anime, detail.names, detail.original_title)
    _upsert_episodes(session, anime, detail.episodes, now)
    _upsert_related_anime(session, anime, detail.related_anime)
    if not detail.poster_source_url:
        return None
    return upsert_poster_record(
        session,
        anime_id=anime.id,
        provider=detail.provider,
        external_id=detail.external_id,
        source_url=detail.poster_source_url,
    )


def add_anime_to_user_library(
    session: Session,
    provider: ImportProvider,
    *,
    user_id: int,
    external_id: str,
    duplicate_resolution: dict[str, Any] | None = None,
) -> tuple[AnimeMetaInfo, UserAnimeProgress, bool, bool, bool]:
    poster_to_enqueue: AnimePoster | None = None
    try:
        user = session.get(User, user_id)
        existing_anime = session.scalar(
            select(AnimeMetaInfo).where(
                AnimeMetaInfo.provider_type == provider.name,
                AnimeMetaInfo.external_id == external_id,
            ),
        )
        if existing_anime is not None:
            existing_progress = get_user_progress(session, user_id=user_id, anime_id=existing_anime.id)
            if existing_progress is not None:
                anime = existing_anime
                anime_created = False
                progress, library_changed, progress_created = _add_anime_progress(
                    session,
                    user_id=user_id,
                    anime_id=anime.id,
                )
                session.flush()
                poster_to_enqueue = session.scalar(select(AnimePoster).where(AnimePoster.anime_id == anime.id))
                session.commit()
                if anime_created and poster_to_enqueue is not None and poster_to_enqueue.status == 'pending':
                    enqueue_poster_download(poster_to_enqueue.id)
                return anime, progress, anime_created, library_changed, progress_created

        detail = provider.get_anime_detail(external_id, language=user.language_preference if user is not None else None)
        conflicts = find_cross_provider_name_conflicts(session, provider.name, detail)
        if conflicts and not (duplicate_resolution or {}).get('useCurrentProvider'):
            use_existing_anime_id = (duplicate_resolution or {}).get('useExistingAnimeId')
            if use_existing_anime_id is None:
                raise DuplicateAnimeConflict(provider.name, external_id, detail.title, conflicts)
            matching_candidate = next((candidate for candidate in conflicts if candidate.anime.id == use_existing_anime_id), None)
            if matching_candidate is None:
                message = 'duplicateResolution.useExistingAnimeId is not a valid conflict candidate'
                raise ValueError(message)
            anime = matching_candidate.anime
            anime_created = False
        elif existing_anime is not None:
            anime = existing_anime
            anime_created = False
        else:
            anime, anime_created = _get_or_import_anime_from_detail(session, detail)
        progress, library_changed, progress_created = _add_anime_progress(
            session,
            user_id=user_id,
            anime_id=anime.id,
        )

        session.flush()
        poster_to_enqueue = session.scalar(select(AnimePoster).where(AnimePoster.anime_id == anime.id))
        session.commit()
    except Exception:
        session.rollback()
        raise

    if anime_created and poster_to_enqueue is not None and poster_to_enqueue.status == 'pending':
        enqueue_poster_download(poster_to_enqueue.id)
    return anime, progress, anime_created, library_changed, progress_created


def switch_user_anime_provider(
    session: Session,
    provider: ImportProvider,
    *,
    user_id: int,
    anime_id: int,
    external_id: str,
) -> ProviderSwitchResult | None:
    poster_to_enqueue: AnimePoster | None = None
    try:
        user = session.get(User, user_id)
        source_progress = get_user_progress(session, user_id=user_id, anime_id=anime_id)
        if source_progress is None:
            return None
        target_anime, target_created = import_anime_from_provider(
            session,
            provider,
            external_id=external_id,
            language=user.language_preference if user is not None else None,
        )
        target_progress = get_user_progress(session, user_id=user_id, anime_id=target_anime.id)
        source_watched = _current_watched_episode_numbers(session, progress=source_progress)
        conflicts = _migrate_watched_episodes(
            session,
            user_id=user_id,
            source_anime_id=anime_id,
            target_anime_id=target_anime.id,
            source_watched=source_watched,
        )
        if target_progress is None:
            source_progress.anime_id = target_anime.id
            source_progress.preferred_name_id = None
            source_progress.preferred_summary_id = None
            source_progress.preferred_poster_id = None
            target_progress = source_progress
        elif target_progress.id != source_progress.id:
            _merge_anime_progress(source_progress, target_progress)
            session.delete(source_progress)
        recalculate_user_anime_progress(session, progress=target_progress)
        if source_watched and target_progress.status == UserAnimeStatus.PLAN_TO_WATCH:
            target_progress.status = UserAnimeStatus.WATCHING
        target_progress.metadata_source = UserAnimeMetadataSource.UPSTREAM.value
        target_progress.metadata_snapshot_id = None
        related_result = reconcile_related_anime_after_provider_switch(
            session,
            user_id=user_id,
            previous_anime_id=anime_id,
            target_anime_id=target_anime.id,
        )
        session.flush()
        create_or_update_metadata_snapshot(session, progress=target_progress)
        target_progress.metadata_snapshot_id = None
        poster_to_enqueue = session.scalar(select(AnimePoster).where(AnimePoster.anime_id == target_anime.id))
        session.commit()
    except Exception:
        session.rollback()
        raise

    if target_created and poster_to_enqueue is not None and poster_to_enqueue.status == 'pending':
        enqueue_poster_download(poster_to_enqueue.id)
    return ProviderSwitchResult(
        anime=target_anime,
        progress=target_progress,
        previous_anime_id=anime_id,
        episode_conflicts=conflicts,
        related_auto_mapped_count=related_result.auto_mapped_count,
        related_manual_mapping_required_count=related_result.manual_mapping_required_count,
    )


def preview_user_anime_provider_switch(
    session: Session,
    provider: ImportProvider,
    *,
    user_id: int,
    anime_id: int,
    external_id: str,
) -> ProviderSwitchResult | None:
    user = session.get(User, user_id)
    source_progress = get_user_progress(session, user_id=user_id, anime_id=anime_id)
    if source_progress is None:
        return None
    target_anime, _target_created = import_anime_from_provider(
        session,
        provider,
        external_id=external_id,
        language=user.language_preference if user is not None else None,
    )
    source_watched = _current_watched_episode_numbers(session, progress=source_progress)
    conflicts = _provider_switch_conflicts(
        session,
        source_anime_id=anime_id,
        target_anime_id=target_anime.id,
        source_watched=source_watched,
    )
    return ProviderSwitchResult(
        anime=target_anime,
        progress=source_progress,
        previous_anime_id=anime_id,
        episode_conflicts=conflicts,
        related_auto_mapped_count=0,
        related_manual_mapping_required_count=0,
    )


def reconcile_related_anime_after_provider_switch(
    session: Session,
    *,
    user_id: int,
    previous_anime_id: int,
    target_anime_id: int,
) -> ProviderSwitchRelatedAnimeResult:
    _retarget_user_related_anime_links(
        session,
        user_id=user_id,
        previous_anime_id=previous_anime_id,
        target_anime_id=target_anime_id,
    )
    _retarget_user_manual_anime_relations(
        session,
        user_id=user_id,
        previous_anime_id=previous_anime_id,
        target_anime_id=target_anime_id,
    )
    _retarget_user_deletion_prompts(
        session,
        user_id=user_id,
        previous_anime_id=previous_anime_id,
        target_anime_id=target_anime_id,
    )
    provider_relations = session.scalars(
        select(AnimeRelation).where(
            AnimeRelation.anime_id == target_anime_id,
            AnimeRelation.relation_type == 'same_series_season',
            AnimeRelation.is_active.is_(True),
        ),
    ).all()
    auto_mapped_count = 0
    manual_mapping_required_count = 0
    for relation in provider_relations:
        if relation.related_anime_id is not None and get_user_progress(session, user_id=user_id, anime_id=relation.related_anime_id) is not None:
            auto_mapped_count += 1
            continue
        related_anime_id = session.scalar(
            select(AnimeMetaInfo.id).where(
                AnimeMetaInfo.provider_type == relation.provider_type,
                AnimeMetaInfo.external_id == relation.external_id,
            ),
        )
        if related_anime_id is not None and get_user_progress(session, user_id=user_id, anime_id=related_anime_id) is not None:
            relation.related_anime_id = related_anime_id
            relation.poster_id = _relation_poster_id(session, related_anime_id=related_anime_id)
            auto_mapped_count += 1
        else:
            manual_mapping_required_count += 1
    return ProviderSwitchRelatedAnimeResult(auto_mapped_count, manual_mapping_required_count)


def _add_anime_progress(
    session: Session,
    *,
    user_id: int,
    anime_id: int,
) -> tuple[UserAnimeProgress, bool, bool]:
    progress = session.scalar(
        select(UserAnimeProgress).where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.anime_id == anime_id,
        ),
    )
    library_changed = False
    progress_created = False
    if progress is None:
        progress = UserAnimeProgress(
            user_id=user_id,
            anime_id=anime_id,
            status=UserAnimeStatus.PLAN_TO_WATCH,
            last_watched_episode_number=0,
        )
        session.add(progress)
        library_changed = True
        progress_created = True
    elif progress.status == UserAnimeStatus.DROPPED:
        progress.status = UserAnimeStatus.PLAN_TO_WATCH
        library_changed = True
    return progress, library_changed, progress_created


def _detail_duplicate_names(detail: ImportAnimeDetail) -> list[str]:
    names = [detail.title]
    if detail.original_title:
        names.append(detail.original_title)
    names.extend(item.name for item in detail.names)
    return names


def _normalize_duplicate_name(value: str) -> str:
    return value.strip().casefold()


def _status_priority(status: UserAnimeStatus) -> int:
    priorities = {
        UserAnimeStatus.PLAN_TO_WATCH: 0,
        UserAnimeStatus.DROPPED: 1,
        UserAnimeStatus.ON_HOLD: 2,
        UserAnimeStatus.WATCHING: 3,
        UserAnimeStatus.COMPLETED: 4,
    }
    return priorities[status]


def _merge_anime_progress(source: UserAnimeProgress, target: UserAnimeProgress) -> None:
    if _status_priority(source.status) > _status_priority(target.status):
        target.status = source.status
    if source.last_watched_episode_number > target.last_watched_episode_number:
        target.last_watched_episode_number = source.last_watched_episode_number
        target.last_watched_at = source.last_watched_at
    elif target.last_watched_at is None and source.last_watched_at is not None:
        target.last_watched_at = source.last_watched_at


def _watched_episode_numbers(
    session: Session,
    *,
    user_id: int,
    anime_id: int,
) -> dict[int, tuple[Episode, UserEpisodeProgress]]:
    rows = session.execute(
        select(Episode, UserEpisodeProgress)
        .join(UserEpisodeProgress, UserEpisodeProgress.episode_id == Episode.id)
        .where(
            Episode.anime_id == anime_id,
            UserEpisodeProgress.user_id == user_id,
            UserEpisodeProgress.watched.is_(True),
        ),
    ).all()
    return {episode.episode_number: (episode, progress) for episode, progress in rows}


def _current_watched_episode_numbers(
    session: Session,
    *,
    progress: UserAnimeProgress,
) -> dict[int, tuple[Any, Any]]:
    if progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        snapshot = _active_metadata_snapshot(session, progress=progress)
        if snapshot is None:
            return {}
        episodes = session.scalars(
            select(UserAnimeMetadataEpisodeSnapshot).where(
                UserAnimeMetadataEpisodeSnapshot.snapshot_id == snapshot.id,
                UserAnimeMetadataEpisodeSnapshot.watched.is_(True),
            ),
        ).all()
        return {episode.episode_number: (episode, episode) for episode in episodes}
    return _watched_episode_numbers(session, user_id=progress.user_id, anime_id=progress.anime_id)


def _active_metadata_snapshot(session: Session, *, progress: UserAnimeProgress) -> UserAnimeMetadataSnapshot | None:
    if progress.metadata_snapshot_id is not None:
        snapshot = session.get(UserAnimeMetadataSnapshot, progress.metadata_snapshot_id)
        if snapshot is not None and snapshot.user_id == progress.user_id and snapshot.anime_id == progress.anime_id:
            return snapshot
    return get_metadata_snapshot(session, user_id=progress.user_id, anime_id=progress.anime_id)


def _current_metadata_episode_rows(session: Session, *, progress: UserAnimeProgress) -> list[dict[str, Any]]:
    if progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        snapshot = _active_metadata_snapshot(session, progress=progress)
        if snapshot is None:
            return []
        return [
            {
                'episode_number': episode.episode_number,
                'title': episode.title,
                'air_at': episode.air_at,
                'duration': episode.duration,
                'status': episode.status,
                'watched': episode.watched,
                'watched_at': episode.watched_at,
                'names': episode.names,
            }
            for episode in session.scalars(
                select(UserAnimeMetadataEpisodeSnapshot)
                .where(UserAnimeMetadataEpisodeSnapshot.snapshot_id == snapshot.id)
                .order_by(UserAnimeMetadataEpisodeSnapshot.episode_number),
            ).all()
        ]
    rows = session.execute(
        select(Episode, UserEpisodeProgress)
        .outerjoin(
            UserEpisodeProgress,
            (UserEpisodeProgress.episode_id == Episode.id) & (UserEpisodeProgress.user_id == progress.user_id),
        )
        .where(Episode.anime_id == progress.anime_id)
        .order_by(Episode.episode_number),
    ).all()
    result: list[dict[str, Any]] = []
    for episode, watch_progress in rows:
        names = session.scalars(select(EpisodeName).where(EpisodeName.episode_id == episode.id).order_by(EpisodeName.id)).all()
        result.append(
            {
                'episode_number': episode.episode_number,
                'title': episode.original_title,
                'air_at': episode.air_at,
                'duration': episode.duration,
                'status': episode.status.value if hasattr(episode.status, 'value') else episode.status,
                'watched': bool(watch_progress.watched) if watch_progress is not None else False,
                'watched_at': watch_progress.watched_at if watch_progress is not None else None,
                'names': json.dumps([{'name': name.name, 'language': name.language} for name in names]),
            },
        )
    return result


def _migrate_watched_episodes(
    session: Session,
    *,
    user_id: int,
    source_anime_id: int,
    target_anime_id: int,
    source_watched: dict[int, tuple[Any, Any]],
) -> list[Any]:
    target_episodes = {
        episode.episode_number: episode
        for episode in session.scalars(select(Episode).where(Episode.anime_id == target_anime_id)).all()
    }
    conflicts = _provider_switch_conflicts(
        session,
        source_anime_id=source_anime_id,
        target_anime_id=target_anime_id,
        source_watched=source_watched,
    )
    for episode_number, (_source_episode, source_progress) in source_watched.items():
        target_episode = target_episodes.get(episode_number)
        if target_episode is None:
            continue
        target_progress = session.scalar(
            select(UserEpisodeProgress).where(
                UserEpisodeProgress.user_id == user_id,
                UserEpisodeProgress.episode_id == target_episode.id,
            ),
        )
        if target_progress is None:
            target_progress = UserEpisodeProgress(user_id=user_id, episode_id=target_episode.id)
            session.add(target_progress)
        target_progress.watched = True
        if target_progress.watched_at is None:
            target_progress.watched_at = source_progress.watched_at
    return conflicts


def _provider_switch_conflicts(
    session: Session,
    *,
    source_anime_id: int,
    target_anime_id: int,
    source_watched: dict[int, tuple[Any, Any]],
) -> list[Any]:
    from app.services.anime_sync import EpisodeConflict

    target_numbers = set(session.scalars(select(Episode.episode_number).where(Episode.anime_id == target_anime_id)).all())
    conflicts: list[Any] = []
    for episode_number, (source_episode, source_progress) in source_watched.items():
        if episode_number in target_numbers:
            continue
        selected_name = session.scalar(select(EpisodeName).where(EpisodeName.episode_id == source_episode.id).order_by(EpisodeName.id)) if isinstance(source_episode, Episode) else None
        source_title = source_episode.original_title if isinstance(source_episode, Episode) else source_episode.title
        conflicts.append(
            EpisodeConflict(
                anime_id=source_anime_id,
                episode_id=source_episode.id,
                episode_number=episode_number,
                display_name=selected_name.name if selected_name is not None else source_title,
                watched_user_count=1,
                watched=True,
                watched_at=source_progress.watched_at.isoformat() if source_progress.watched_at else None,
                reason='missing_target_episode',
            ),
        )
    return conflicts


def _retarget_user_related_anime_links(
    session: Session,
    *,
    user_id: int,
    previous_anime_id: int,
    target_anime_id: int,
) -> None:
    relation_ids = set(
        session.scalars(select(AnimeRelation.id).where(AnimeRelation.related_anime_id == previous_anime_id)).all(),
    )
    relation_ids.update(
        session.scalars(
            select(UserAnimeRelationOverride.anime_relation_id).where(
                UserAnimeRelationOverride.user_id == user_id,
                UserAnimeRelationOverride.related_anime_id == previous_anime_id,
            ),
        ).all(),
    )
    for relation_id in relation_ids:
        override = session.scalar(
            select(UserAnimeRelationOverride).where(
                UserAnimeRelationOverride.user_id == user_id,
                UserAnimeRelationOverride.anime_relation_id == relation_id,
            ),
        )
        if override is None:
            override = UserAnimeRelationOverride(user_id=user_id, anime_relation_id=relation_id, related_anime_id=target_anime_id)
            session.add(override)
        else:
            override.related_anime_id = target_anime_id


def _retarget_user_manual_anime_relations(
    session: Session,
    *,
    user_id: int,
    previous_anime_id: int,
    target_anime_id: int,
) -> None:
    if previous_anime_id == target_anime_id:
        return
    relations = session.scalars(
        select(UserManualAnimeRelation).where(
            UserManualAnimeRelation.user_id == user_id,
            (UserManualAnimeRelation.anime_id_low == previous_anime_id) | (UserManualAnimeRelation.anime_id_high == previous_anime_id),
        ),
    ).all()
    for relation in relations:
        other_id = relation.anime_id_high if relation.anime_id_low == previous_anime_id else relation.anime_id_low
        if other_id == target_anime_id:
            session.delete(relation)
            continue
        low_id, high_id = sorted((target_anime_id, other_id))
        duplicate = session.scalar(
            select(UserManualAnimeRelation).where(
                UserManualAnimeRelation.user_id == user_id,
                UserManualAnimeRelation.anime_id_low == low_id,
                UserManualAnimeRelation.anime_id_high == high_id,
                UserManualAnimeRelation.relation_type == relation.relation_type,
                UserManualAnimeRelation.id != relation.id,
            ),
        )
        if duplicate is not None:
            session.delete(relation)
            continue
        relation.anime_id_low = low_id
        relation.anime_id_high = high_id


def _retarget_user_deletion_prompts(
    session: Session,
    *,
    user_id: int,
    previous_anime_id: int,
    target_anime_id: int,
) -> None:
    if previous_anime_id == target_anime_id:
        return
    prompts = session.scalars(
        select(UserAnimeRelationDeletionPrompt).where(
            UserAnimeRelationDeletionPrompt.user_id == user_id,
            UserAnimeRelationDeletionPrompt.status == 'pending',
            (UserAnimeRelationDeletionPrompt.anime_id == previous_anime_id)
            | (UserAnimeRelationDeletionPrompt.related_anime_id == previous_anime_id),
        ),
    ).all()
    for prompt in prompts:
        if prompt.anime_id == previous_anime_id:
            prompt.anime_id = target_anime_id
        if prompt.related_anime_id == previous_anime_id:
            prompt.related_anime_id = target_anime_id


def _fallback_related_relations(session: Session, *, user_id: int, anime_id: int) -> list[AnimeRelation]:
    overrides = session.scalars(
        select(UserAnimeRelationOverride).where(
            UserAnimeRelationOverride.user_id == user_id,
            UserAnimeRelationOverride.related_anime_id == anime_id,
        ),
    ).all()
    if not overrides:
        return []
    relation_ids = [override.anime_relation_id for override in overrides]
    previous_source_ids = {
        relation.related_anime_id
        for relation in session.scalars(select(AnimeRelation).where(AnimeRelation.id.in_(relation_ids))).all()
        if relation.related_anime_id is not None and relation.related_anime_id != anime_id
    }
    if previous_source_ids:
        source_relations = session.scalars(
            select(AnimeRelation).where(
                AnimeRelation.anime_id.in_(previous_source_ids),
                AnimeRelation.relation_type == 'same_series_season',
                AnimeRelation.is_active.is_(True),
            ),
        ).all()
        if source_relations:
            return list(source_relations)
    return list(session.scalars(
        select(AnimeRelation).where(
            AnimeRelation.id.in_(relation_ids),
            AnimeRelation.relation_type == 'same_series_season',
            AnimeRelation.is_active.is_(True),
        ),
    ).all())


def get_user_progress(session: Session, *, user_id: int, anime_id: int) -> UserAnimeProgress | None:
    return session.scalar(
        select(UserAnimeProgress).where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.anime_id == anime_id,
        ),
    )


def get_metadata_snapshot(session: Session, *, user_id: int, anime_id: int) -> UserAnimeMetadataSnapshot | None:
    return session.scalar(
        select(UserAnimeMetadataSnapshot).where(
            UserAnimeMetadataSnapshot.user_id == user_id,
            UserAnimeMetadataSnapshot.anime_id == anime_id,
        ),
    )


def create_or_update_metadata_snapshot(session: Session, *, progress: UserAnimeProgress) -> UserAnimeMetadataSnapshot:
    anime = session.get(AnimeMetaInfo, progress.anime_id)
    if anime is None:
        msg = 'Anime not found'
        raise ValueError(msg)
    rows = _current_metadata_episode_rows(session, progress=progress)
    snapshot = get_metadata_snapshot(session, user_id=progress.user_id, anime_id=progress.anime_id)
    if snapshot is None:
        snapshot = UserAnimeMetadataSnapshot(user_id=progress.user_id, anime_id=progress.anime_id, source_provider=anime.provider_type, source_external_id=anime.external_id, source_title=anime.original_name)
        session.add(snapshot)
        session.flush()
    snapshot.source_anime_id = anime.id
    snapshot.source_provider = anime.provider_type
    snapshot.source_external_id = anime.external_id
    snapshot.source_title = anime.original_name
    snapshot.episode_count = len(rows)
    session.execute(delete(UserAnimeMetadataEpisodeSnapshot).where(UserAnimeMetadataEpisodeSnapshot.snapshot_id == snapshot.id))
    for row in rows:
        session.add(
            UserAnimeMetadataEpisodeSnapshot(
                snapshot_id=snapshot.id,
                episode_number=row['episode_number'],
                title=row['title'],
                air_at=row['air_at'],
                duration=row['duration'],
                status=row['status'],
                watched=bool(row['watched']),
                watched_at=row['watched_at'],
                names=row['names'],
            ),
        )
    session.flush()
    return snapshot


def set_anime_metadata_source(session: Session, *, progress: UserAnimeProgress, source: str) -> UserAnimeProgress:
    if source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        snapshot = create_or_update_metadata_snapshot(session, progress=progress)
        progress.metadata_source = UserAnimeMetadataSource.LOCAL_SNAPSHOT.value
        progress.metadata_snapshot_id = snapshot.id
    elif source == UserAnimeMetadataSource.UPSTREAM.value:
        progress.metadata_source = UserAnimeMetadataSource.UPSTREAM.value
        progress.metadata_snapshot_id = None
    else:
        msg = 'Unknown metadata source'
        raise ValueError(msg)
    session.commit()
    return progress


def get_episode_rows_for_progress(
    session: Session,
    *,
    progress: UserAnimeProgress,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int, bool]:
    if progress.metadata_source != UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        from app.models.progress import get_anime_episodes_with_watch_state

        rows = get_anime_episodes_with_watch_state(session, anime_id=progress.anime_id, user_id=progress.user_id, limit=limit, offset=offset)
        total = session.scalar(select(func.count(Episode.id)).where(Episode.anime_id == progress.anime_id)) or 0
        return rows, total, False
    snapshot = _active_metadata_snapshot(session, progress=progress)
    if snapshot is None:
        return [], 0, True
    total = session.scalar(select(func.count(UserAnimeMetadataEpisodeSnapshot.id)).where(UserAnimeMetadataEpisodeSnapshot.snapshot_id == snapshot.id)) or 0
    rows = [
        {
            'episode_id': episode.id,
            'episode_number': episode.episode_number,
            'original_title': episode.title,
            'air_at': episode.air_at,
            'duration': episode.duration,
            'status': episode.status,
            'watched': episode.watched,
            'watched_at': episode.watched_at,
            'preferred_name_id': None,
        }
        for episode in session.scalars(
            select(UserAnimeMetadataEpisodeSnapshot)
            .where(UserAnimeMetadataEpisodeSnapshot.snapshot_id == snapshot.id)
            .order_by(UserAnimeMetadataEpisodeSnapshot.episode_number)
            .limit(limit)
            .offset(offset),
        ).all()
    ]
    return rows, total, True


def set_episode_watch_state_bulk(
    session: Session,
    *,
    progress: UserAnimeProgress,
    watched: bool,
    scope: str,
    through_episode_number: int | None = None,
) -> tuple[int, int]:
    now = datetime.now(UTC)
    matched_count = 0
    changed_count = 0
    if progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        snapshot = _active_metadata_snapshot(session, progress=progress)
        if snapshot is None:
            return 0, 0
        snapshot_statement = select(UserAnimeMetadataEpisodeSnapshot).where(
            UserAnimeMetadataEpisodeSnapshot.snapshot_id == snapshot.id,
        )
        if scope == 'aired':
            snapshot_statement = snapshot_statement.where(UserAnimeMetadataEpisodeSnapshot.status == EpisodeStatus.AIRED.value)
        elif scope == 'through':
            snapshot_statement = snapshot_statement.where(UserAnimeMetadataEpisodeSnapshot.episode_number <= through_episode_number)
        snapshot_episodes = session.scalars(snapshot_statement).all()
        matched_count = len(snapshot_episodes)
        for snapshot_episode in snapshot_episodes:
            if snapshot_episode.watched == watched:
                continue
            snapshot_episode.watched = watched
            snapshot_episode.watched_at = now if watched else None
            changed_count += 1
    else:
        episode_statement = select(Episode).where(Episode.anime_id == progress.anime_id)
        if scope == 'aired':
            episode_statement = episode_statement.where(Episode.status == EpisodeStatus.AIRED)
        elif scope == 'through':
            episode_statement = episode_statement.where(Episode.episode_number <= through_episode_number)
        upstream_episodes = session.scalars(episode_statement).all()
        matched_count = len(upstream_episodes)
        episode_ids = [episode.id for episode in upstream_episodes]
        existing = {
            item.episode_id: item
            for item in session.scalars(
                select(UserEpisodeProgress).where(
                    UserEpisodeProgress.user_id == progress.user_id,
                    UserEpisodeProgress.episode_id.in_(episode_ids),
                ),
            ).all()
        } if episode_ids else {}
        for upstream_episode in upstream_episodes:
            watch_progress = existing.get(upstream_episode.id)
            current = bool(watch_progress and watch_progress.watched)
            if current == watched:
                continue
            if watch_progress is None:
                watch_progress = UserEpisodeProgress(user_id=progress.user_id, episode_id=upstream_episode.id)
                session.add(watch_progress)
            watch_progress.watched = watched
            watch_progress.watched_at = now if watched else None
            changed_count += 1

    if watched and changed_count > 0 and progress.status == UserAnimeStatus.PLAN_TO_WATCH:
        progress.status = UserAnimeStatus.WATCHING
    session.flush()
    recalculate_user_anime_progress(session, progress=progress, marked_watched=watched and changed_count > 0)
    session.commit()
    return matched_count, changed_count


def update_user_anime_status(
    session: Session,
    *,
    progress: UserAnimeProgress,
    status: UserAnimeStatus,
) -> UserAnimeProgress:
    if status == UserAnimeStatus.PLAN_TO_WATCH:
        episode_ids = select(Episode.id).where(Episode.anime_id == progress.anime_id)
        session.execute(
            delete(UserEpisodeProgress).where(
                UserEpisodeProgress.user_id == progress.user_id,
                UserEpisodeProgress.episode_id.in_(episode_ids),
            ),
        )
        progress.last_watched_episode_number = 0
        progress.last_watched_at = None
    elif status == UserAnimeStatus.DROPPED:
        _delete_user_related_anime_state_for_anime(session, user_id=progress.user_id, anime_id=progress.anime_id)
    progress.status = status
    session.commit()
    return progress


def _delete_user_related_anime_state_for_anime(session: Session, *, user_id: int, anime_id: int) -> None:
    relation_ids_from_anime = select(AnimeRelation.id).where(AnimeRelation.anime_id == anime_id)
    session.execute(
        delete(UserAnimeRelationOverride).where(
            UserAnimeRelationOverride.user_id == user_id,
            (UserAnimeRelationOverride.related_anime_id == anime_id)
            | (UserAnimeRelationOverride.anime_relation_id.in_(relation_ids_from_anime)),
        ),
    )
    session.execute(
        delete(UserManualAnimeRelation).where(
            UserManualAnimeRelation.user_id == user_id,
            (UserManualAnimeRelation.anime_id_low == anime_id) | (UserManualAnimeRelation.anime_id_high == anime_id),
        ),
    )
    session.execute(
        delete(UserAnimeRelationDeletionPrompt).where(
            UserAnimeRelationDeletionPrompt.user_id == user_id,
            (UserAnimeRelationDeletionPrompt.anime_id == anime_id) | (UserAnimeRelationDeletionPrompt.related_anime_id == anime_id),
        ),
    )


def set_episode_watch_state(
    session: Session,
    *,
    progress: UserAnimeProgress,
    episode: Episode,
    watched: bool,
) -> UserEpisodeProgress | None:
    watch_progress = session.scalar(
        select(UserEpisodeProgress).where(
            UserEpisodeProgress.user_id == progress.user_id,
            UserEpisodeProgress.episode_id == episode.id,
        ),
    )
    if watched:
        if watch_progress is None:
            watch_progress = UserEpisodeProgress(user_id=progress.user_id, episode_id=episode.id)
            session.add(watch_progress)
        watch_progress.watched = True
        watch_progress.watched_at = datetime.now(UTC)
        if progress.status == UserAnimeStatus.PLAN_TO_WATCH:
            progress.status = UserAnimeStatus.WATCHING
    elif watch_progress is not None:
        watch_progress.watched = False
        watch_progress.watched_at = None

    session.flush()
    recalculate_user_anime_progress(session, progress=progress, marked_watched=watched)
    session.commit()
    return watch_progress


def set_snapshot_episode_watch_state(
    session: Session,
    *,
    progress: UserAnimeProgress,
    episode_id: int,
    watched: bool,
) -> UserAnimeMetadataEpisodeSnapshot | None:
    snapshot = _active_metadata_snapshot(session, progress=progress)
    if snapshot is None:
        return None
    episode = session.get(UserAnimeMetadataEpisodeSnapshot, episode_id)
    if episode is None or episode.snapshot_id != snapshot.id:
        return None
    episode.watched = watched
    episode.watched_at = datetime.now(UTC) if watched else None
    if watched and progress.status == UserAnimeStatus.PLAN_TO_WATCH:
        progress.status = UserAnimeStatus.WATCHING
    session.flush()
    recalculate_user_anime_progress(session, progress=progress, marked_watched=watched)
    session.commit()
    return episode


def recalculate_user_anime_progress(
    session: Session,
    *,
    progress: UserAnimeProgress,
    marked_watched: bool = False,
) -> None:
    if progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        row = session.execute(
            select(UserAnimeMetadataEpisodeSnapshot.episode_number, UserAnimeMetadataEpisodeSnapshot.watched_at)
            .where(
                UserAnimeMetadataEpisodeSnapshot.snapshot_id == progress.metadata_snapshot_id,
                UserAnimeMetadataEpisodeSnapshot.watched.is_(True),
            )
            .order_by(UserAnimeMetadataEpisodeSnapshot.episode_number.desc())
            .limit(1),
        ).first()
        if row is None:
            progress.last_watched_episode_number = 0
            progress.last_watched_at = None
        else:
            progress.last_watched_episode_number = row.episode_number
            progress.last_watched_at = row.watched_at
        return
    row = session.execute(
        select(Episode.episode_number, UserEpisodeProgress.watched_at)
        .join(UserEpisodeProgress, UserEpisodeProgress.episode_id == Episode.id)
        .where(
            Episode.anime_id == progress.anime_id,
            UserEpisodeProgress.user_id == progress.user_id,
            UserEpisodeProgress.watched.is_(True),
        )
        .order_by(Episode.episode_number.desc())
        .limit(1),
    ).first()
    if row is None:
        progress.last_watched_episode_number = 0
        progress.last_watched_at = None
    else:
        progress.last_watched_episode_number = row.episode_number
        progress.last_watched_at = row.watched_at

    if not marked_watched or progress.status in {UserAnimeStatus.ON_HOLD, UserAnimeStatus.DROPPED}:
        return

    anime = session.get(AnimeMetaInfo, progress.anime_id)
    watched_count = session.scalar(
        select(func.count(UserEpisodeProgress.id))
        .join(Episode, Episode.id == UserEpisodeProgress.episode_id)
        .where(
            Episode.anime_id == progress.anime_id,
            UserEpisodeProgress.user_id == progress.user_id,
            UserEpisodeProgress.watched.is_(True),
        ),
    ) or 0
    if anime is not None and anime.total_episodes and watched_count == anime.total_episodes:
        progress.status = UserAnimeStatus.COMPLETED
        return
    if anime is not None and anime.total_episodes is None:
        aired_count = session.scalar(
            select(func.count(Episode.id)).where(
                Episode.anime_id == progress.anime_id,
                Episode.status == EpisodeStatus.AIRED,
            ),
        ) or 0
        watched_aired_count = session.scalar(
            select(func.count(UserEpisodeProgress.id))
            .join(Episode, Episode.id == UserEpisodeProgress.episode_id)
            .where(
                Episode.anime_id == progress.anime_id,
                Episode.status == EpisodeStatus.AIRED,
                UserEpisodeProgress.user_id == progress.user_id,
                UserEpisodeProgress.watched.is_(True),
            ),
        ) or 0
        if aired_count > 0 and watched_aired_count == aired_count:
            progress.status = UserAnimeStatus.COMPLETED


def set_summary_preference(
    session: Session,
    *,
    progress: UserAnimeProgress,
    summary_id: int | None,
) -> UserAnimeProgress | None:
    if summary_id is not None:
        summary = session.get(AnimeSummary, summary_id)
        if summary is None or summary.anime_id != progress.anime_id:
            return None
    progress.preferred_summary_id = summary_id
    session.commit()
    return progress


def set_poster_preference(
    session: Session,
    *,
    progress: UserAnimeProgress,
    poster_id: int | None,
) -> UserAnimeProgress | None:
    if poster_id is not None:
        poster = session.get(AnimePoster, poster_id)
        if poster is None or poster.anime_id != progress.anime_id:
            return None
    progress.preferred_poster_id = poster_id
    session.commit()
    return progress


def set_anime_name_preference(
    session: Session,
    *,
    progress: UserAnimeProgress,
    name_id: int | None,
) -> UserAnimeProgress | None:
    if name_id is not None:
        name = session.get(AnimeName, name_id)
        if name is None or name.anime_id != progress.anime_id:
            return None
    progress.preferred_name_id = name_id
    session.commit()
    return progress


def set_episode_name_preference(
    session: Session,
    *,
    progress: UserAnimeProgress,
    episode: Episode,
    name_id: int | None,
) -> UserEpisodeProgress | None:
    if name_id is not None:
        name = session.get(EpisodeName, name_id)
        if name is None or name.episode_id != episode.id:
            return None
    episode_progress = session.scalar(
        select(UserEpisodeProgress).where(
            UserEpisodeProgress.user_id == progress.user_id,
            UserEpisodeProgress.episode_id == episode.id,
        ),
    )
    if episode_progress is None:
        episode_progress = UserEpisodeProgress(
            user_id=progress.user_id,
            episode_id=episode.id,
            watched=False,
            watched_at=None,
        )
        session.add(episode_progress)
    episode_progress.preferred_name_id = name_id
    session.commit()
    return episode_progress


def _upsert_summaries(session: Session, anime: AnimeMetaInfo, summaries: Sequence[ImportAnimeSummary]) -> None:
    for item in summaries:
        text = item.summary.strip()
        if not text:
            continue
        summary = session.scalar(
            select(AnimeSummary).where(
                AnimeSummary.anime_id == anime.id,
                AnimeSummary.language == item.language,
            ),
        )
        if summary is None:
            summary = AnimeSummary(
                anime_id=anime.id,
                language=item.language,
            )
            session.add(summary)
        summary.summary = text


def _upsert_names(session: Session, anime: AnimeMetaInfo, names: Sequence[ImportAnimeName], original_title: str | None) -> None:
    values = [(item.name.strip(), item.language) for item in names if item.name.strip()]
    if original_title:
        values.append((original_title, None))
    existing = set(
        session.scalars(select(AnimeName.name).where(AnimeName.anime_id == anime.id)).all(),
    )
    for name, language in values:
        if name in existing:
            continue
        session.add(AnimeName(anime_id=anime.id, name=name, language=language))
        existing.add(name)


def _upsert_episodes(session: Session, anime: AnimeMetaInfo, episodes: Sequence[ImportEpisodeInfo], synced_at: datetime) -> None:
    existing = {
        episode.episode_number: episode
        for episode in session.scalars(select(Episode).where(Episode.anime_id == anime.id)).all()
    }
    # Some upstream Bangumi entries represent a movie/special as a single episode
    # but omit episode-level metadata. Reuse anime-level metadata in that narrow case
    # so the frontend can render a sensible single-entry detail page.
    fallback_air_at = _single_episode_fallback_air_at(anime.air_date, episodes)
    fallback_title = _single_movie_episode_fallback_title(anime, episodes)
    for item in episodes:
        episode = existing.get(item.episode_number)
        if episode is None:
            episode = Episode(anime_id=anime.id, episode_number=item.episode_number)
            session.add(episode)
            existing[item.episode_number] = episode
        resolved_air_at = item.air_at or fallback_air_at
        resolved_title = item.title or fallback_title
        episode.original_title = resolved_title
        episode.air_at = resolved_air_at
        episode.duration = item.duration
        episode.status = _resolved_episode_status(item.status, resolved_air_at)
        episode.last_synced_at = synced_at
        session.flush()
        _upsert_episode_names(session, episode, item.names, resolved_title)


def _upsert_episode_names(
    session: Session,
    episode: Episode,
    names: Sequence[ImportEpisodeName],
    title: str | None,
) -> None:
    values = [(item.name.strip(), item.language) for item in names if item.name.strip()]
    if title:
        values.append((title, None))
    existing = set(
        session.scalars(select(EpisodeName.name).where(EpisodeName.episode_id == episode.id)).all(),
    )
    for name, language in values:
        if name in existing:
            continue
        session.add(EpisodeName(episode_id=episode.id, name=name, language=language))
        existing.add(name)


def _upsert_related_anime(session: Session, anime: AnimeMetaInfo, related_items: Sequence[ImportRelatedAnime]) -> None:
    active_keys: set[tuple[str, str, str]] = set()
    for item in related_items:
        if item.provider == anime.provider_type and item.external_id == anime.external_id:
            continue
        title = item.title.strip()
        if not title:
            continue
        active_keys.add((item.provider, item.external_id, item.relation_type))
        related_anime_id = session.scalar(
            select(AnimeMetaInfo.id).where(
                AnimeMetaInfo.provider_type == item.provider,
                AnimeMetaInfo.external_id == item.external_id,
            ),
        )
        poster_id = _relation_poster_id(session, related_anime_id=related_anime_id)
        relation = session.scalar(
            select(AnimeRelation).where(
                AnimeRelation.anime_id == anime.id,
                AnimeRelation.provider_type == item.provider,
                AnimeRelation.external_id == item.external_id,
                AnimeRelation.relation_type == item.relation_type,
            ),
        )
        if relation is None:
            relation = AnimeRelation(
                anime_id=anime.id,
                provider_type=item.provider,
                external_id=item.external_id,
                relation_type=item.relation_type,
            )
            session.add(relation)
        relation.related_anime_id = related_anime_id
        relation.poster_id = poster_id
        relation.title = title
        relation.season_number = item.season_number
        relation.air_date = item.air_date
        relation.episode_count = item.episode_count
        relation.url = item.url
        relation.poster_source_url = item.poster_source_url
        relation.is_active = True
        relation.removed_at = None

    stale_same_series = session.scalars(
        select(AnimeRelation).where(
            AnimeRelation.anime_id == anime.id,
            AnimeRelation.relation_type == 'same_series_season',
        ),
    ).all()
    for relation in stale_same_series:
        if (relation.provider_type, relation.external_id, relation.relation_type) not in active_keys:
            relation.is_active = False
            relation.removed_at = datetime.now(UTC)

    session.flush()
    session.execute(
        update(AnimeRelation)
        .where(
            AnimeRelation.provider_type == anime.provider_type,
            AnimeRelation.external_id == anime.external_id,
        )
        .values(related_anime_id=anime.id, poster_id=_relation_poster_id(session, related_anime_id=anime.id)),
    )


def _relation_poster_id(session: Session, *, related_anime_id: int | None) -> int | None:
    if related_anime_id is None:
        return None
    return session.scalar(
        select(AnimePoster.id)
        .where(AnimePoster.anime_id == related_anime_id)
        .order_by(AnimePoster.status != 'ready', AnimePoster.id),
    )


def _anime_type(value: str) -> AnimeType:
    try:
        return AnimeType(value)
    except ValueError:
        return AnimeType.UNKNOWN


def _episode_status(value: str) -> EpisodeStatus:
    try:
        return EpisodeStatus(value)
    except ValueError:
        return EpisodeStatus.UNKNOWN


def _resolved_episode_status(value: str, air_at: datetime | None) -> EpisodeStatus:
    if air_at is not None:
        today = datetime.now(UTC).date()
        return EpisodeStatus.AIRED if air_at.date() <= today else EpisodeStatus.UPCOMING
    return _episode_status(value)


def _first_episode_air_date(episodes: Sequence[ImportEpisodeInfo]) -> date | None:
    dates = [episode.air_at.date() for episode in episodes if episode.air_at is not None]
    return min(dates) if dates else None


def _single_episode_fallback_air_at(anime_air_date: date | None, episodes: Sequence[ImportEpisodeInfo]) -> datetime | None:
    # Bangumi sometimes stores the release date only on the anime/movie subject and
    # leaves the lone episode without air time. Promote the anime-level air_date to
    # the single episode so downstream logic can treat it as aired/upcoming correctly.
    if anime_air_date is None or len(episodes) != 1:
        return None
    if episodes[0].air_at is not None:
        return None
    return datetime.combine(anime_air_date, datetime.min.time(), tzinfo=UTC)


def _single_movie_episode_fallback_title(anime: AnimeMetaInfo, episodes: Sequence[ImportEpisodeInfo]) -> str | None:
    # Single-entry movie records can miss the episode title entirely. Falling back to
    # the anime title keeps the episode list readable and avoids blank labels in the UI.
    if anime.type != AnimeType.MOVIE or len(episodes) != 1:
        return None
    if episodes[0].title is not None and episodes[0].title.strip():
        return None
    return anime.original_name.strip() or None
