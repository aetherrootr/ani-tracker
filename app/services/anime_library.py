from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import delete, func, select
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
    AnimeSummary,
    AnimeType,
    Episode,
    EpisodeName,
    EpisodeStatus,
)
from app.models.progress import UserAnimeProgress, UserAnimeStatus, UserEpisodeProgress
from app.services.anime_poster import enqueue_poster_download, upsert_poster_record


def import_anime_from_provider(
    session: Session,
    provider: ImportProvider,
    *,
    external_id: str,
) -> tuple[AnimeMetaInfo, bool]:
    anime = session.scalar(
        select(AnimeMetaInfo).where(
            AnimeMetaInfo.provider_type == provider.name,
            AnimeMetaInfo.external_id == external_id,
        ),
    )
    if anime is not None:
        return anime, False

    detail = provider.get_anime_detail(external_id)
    anime = AnimeMetaInfo(
        provider_type=detail.provider,
        external_id=detail.external_id,
        original_name=detail.title,
    )
    session.add(anime)
    session.flush()
    populate_anime_from_detail(session, anime, detail)

    return anime, True


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
) -> tuple[AnimeMetaInfo, UserAnimeProgress, bool, bool, bool]:
    poster_to_enqueue: AnimePoster | None = None
    try:
        anime, anime_created = import_anime_from_provider(session, provider, external_id=external_id)
        progress = session.scalar(
            select(UserAnimeProgress).where(
                UserAnimeProgress.user_id == user_id,
                UserAnimeProgress.anime_id == anime.id,
            ),
        )
        library_changed = False
        progress_created = False
        if progress is None:
            progress = UserAnimeProgress(
                user_id=user_id,
                anime_id=anime.id,
                status=UserAnimeStatus.PLAN_TO_WATCH,
                last_watched_episode_number=0,
            )
            session.add(progress)
            library_changed = True
            progress_created = True
        elif progress.status == UserAnimeStatus.DROPPED:
            progress.status = UserAnimeStatus.PLAN_TO_WATCH
            library_changed = True

        session.flush()
        poster_to_enqueue = session.scalar(select(AnimePoster).where(AnimePoster.anime_id == anime.id))
        session.commit()
    except Exception:
        session.rollback()
        raise

    if anime_created and poster_to_enqueue is not None and poster_to_enqueue.status == 'pending':
        enqueue_poster_download(poster_to_enqueue.id)
    return anime, progress, anime_created, library_changed, progress_created


def get_user_progress(session: Session, *, user_id: int, anime_id: int) -> UserAnimeProgress | None:
    return session.scalar(
        select(UserAnimeProgress).where(
            UserAnimeProgress.user_id == user_id,
            UserAnimeProgress.anime_id == anime_id,
        ),
    )


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
    progress.status = status
    session.commit()
    return progress


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


def recalculate_user_anime_progress(
    session: Session,
    *,
    progress: UserAnimeProgress,
    marked_watched: bool = False,
) -> None:
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
