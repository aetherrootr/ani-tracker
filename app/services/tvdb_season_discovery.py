from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.import_provider.base import ImportProvider
from app.models.anime import AnimeMetaInfo, AnimePoster, AnimeRelation
from app.models.progress import UserAnimeProgress, UserAnimeStatus
from app.models.user import User
from app.services.anime_library import import_anime_from_provider
from app.services.anime_poster import enqueue_poster_download
from app.services.anime_sync import sync_anime_from_provider

ELIGIBLE_TVDB_SEASON_STATUSES = {
    UserAnimeStatus.PLAN_TO_WATCH,
    UserAnimeStatus.WATCHING,
    UserAnimeStatus.COMPLETED,
}


@dataclass(frozen=True)
class TvdbSeasonDiscoveryResult:
    checked: bool
    skipped_reason: str | None = None
    imported_anime_ids: list[int] = field(default_factory=list)
    existing_anime_ids: list[int] = field(default_factory=list)
    poster_ids_to_enqueue: list[int] = field(default_factory=list)


def discover_tvdb_seasons_for_user_anime(
    session: Session,
    provider: ImportProvider,
    *,
    user_id: int,
    anime_id: int,
    enqueue_posters: bool = True,
) -> TvdbSeasonDiscoveryResult:
    progress = session.scalar(
        select(UserAnimeProgress).where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.anime_id == anime_id,
        ),
    )
    anime = session.get(AnimeMetaInfo, anime_id)
    if progress is None or anime is None:
        return TvdbSeasonDiscoveryResult(checked=False, skipped_reason='not_in_library')
    if anime.provider_type != 'tvdb' or provider.name != 'tvdb':
        return TvdbSeasonDiscoveryResult(checked=False, skipped_reason='not_tvdb')
    if progress.status not in ELIGIBLE_TVDB_SEASON_STATUSES:
        return TvdbSeasonDiscoveryResult(checked=False, skipped_reason='status_not_eligible')

    user = session.get(User, user_id)
    sync_result = sync_anime_from_provider(session, provider, anime_id=anime_id, user_id=user_id)
    if sync_result is None:
        return TvdbSeasonDiscoveryResult(checked=False, skipped_reason='not_found')
    session.flush()

    relations = session.scalars(
        select(AnimeRelation).where(
            AnimeRelation.anime_id == anime_id,
            AnimeRelation.provider_type == 'tvdb',
            AnimeRelation.relation_type == 'same_series_season',
        ),
    ).all()
    if not _related_library_statuses_are_eligible(session, user_id=user_id, relations=relations):
        session.commit()
        _enqueue_posters(sync_result.poster_ids_to_enqueue, enqueue_posters=enqueue_posters)
        return TvdbSeasonDiscoveryResult(
            checked=True,
            skipped_reason='related_status_not_eligible',
            poster_ids_to_enqueue=sync_result.poster_ids_to_enqueue,
        )

    imported_ids: list[int] = []
    existing_ids: list[int] = []
    poster_ids = list(sync_result.poster_ids_to_enqueue)
    language = user.language_preference if user is not None else None
    for relation in relations:
        related_progress = _progress_for_relation(session, user_id=user_id, relation=relation)
        if related_progress is not None:
            existing_ids.append(related_progress.anime_id)
            continue
        related_anime, created = import_anime_from_provider(
            session,
            provider,
            external_id=relation.external_id,
            language=language,
        )
        progress = UserAnimeProgress(
            user_id=user_id,
            anime_id=related_anime.id,
            status=UserAnimeStatus.PLAN_TO_WATCH,
            last_watched_episode_number=0,
        )
        session.add(progress)
        session.flush()
        relation.related_anime_id = related_anime.id
        imported_ids.append(related_anime.id)
        poster = session.scalar(select(AnimePoster).where(AnimePoster.anime_id == related_anime.id))
        if created and poster is not None and poster.status in {'pending', 'failed'}:
            poster.status = 'pending'
            poster.last_error = None
            poster_ids.append(poster.id)

    session.commit()
    _enqueue_posters(poster_ids, enqueue_posters=enqueue_posters)
    return TvdbSeasonDiscoveryResult(
        checked=True,
        imported_anime_ids=imported_ids,
        existing_anime_ids=existing_ids,
        poster_ids_to_enqueue=poster_ids,
    )


def _related_library_statuses_are_eligible(
    session: Session,
    *,
    user_id: int,
    relations: Sequence[AnimeRelation],
) -> bool:
    related_ids = [relation.related_anime_id for relation in relations if relation.related_anime_id is not None]
    if not related_ids:
        return True
    statuses = session.scalars(
        select(UserAnimeProgress.status).where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.anime_id.in_(related_ids),
        ),
    ).all()
    return all(status in ELIGIBLE_TVDB_SEASON_STATUSES for status in statuses)


def _progress_for_relation(session: Session, *, user_id: int, relation: AnimeRelation) -> UserAnimeProgress | None:
    if relation.related_anime_id is not None:
        progress = session.scalar(
            select(UserAnimeProgress).where(
                UserAnimeProgress.user_id == user_id,
                UserAnimeProgress.anime_id == relation.related_anime_id,
            ),
        )
        if progress is not None:
            return progress
    related_anime_id = session.scalar(
        select(AnimeMetaInfo.id).where(
            AnimeMetaInfo.provider_type == relation.provider_type,
            AnimeMetaInfo.external_id == relation.external_id,
        ),
    )
    if related_anime_id is None:
        return None
    return session.scalar(
        select(UserAnimeProgress).where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.anime_id == related_anime_id,
        ),
    )


def _enqueue_posters(poster_ids: list[int], *, enqueue_posters: bool) -> None:
    if not enqueue_posters:
        return
    for poster_id in dict.fromkeys(poster_ids):
        enqueue_poster_download(poster_id)
