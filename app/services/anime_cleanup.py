from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.anime import AnimeMetaInfo, Episode
from app.models.progress import UserAnimeProgress
from app.services.anime_poster import resolve_poster_path

logger = logging.getLogger(__name__)


def delete_untracked_anime(session: Session, *, poster_storage_dir: str) -> dict[str, int]:
    tracked_anime = select(UserAnimeProgress.id).where(
        UserAnimeProgress.anime_id == AnimeMetaInfo.id,
    )
    anime_list = list(
        session.scalars(
            select(AnimeMetaInfo)
            .options(
                selectinload(AnimeMetaInfo.names),
                selectinload(AnimeMetaInfo.episodes).selectinload(Episode.names),
                selectinload(AnimeMetaInfo.episodes).selectinload(Episode.user_progresses),
                selectinload(AnimeMetaInfo.posters),
                selectinload(AnimeMetaInfo.summaries),
            )
            .where(~tracked_anime.exists()),
        ),
    )
    poster_paths = [poster.storage_path for anime in anime_list for poster in anime.posters]

    for anime in anime_list:
        session.delete(anime)
    session.commit()

    deleted_posters = _delete_poster_files(poster_storage_dir, poster_paths)
    return {'deletedAnime': len(anime_list), 'deletedPosters': deleted_posters}


def _delete_poster_files(storage_dir: str, poster_paths: list[str]) -> int:
    deleted = 0
    for storage_path in poster_paths:
        poster_path = resolve_poster_path(storage_dir, storage_path)
        if poster_path is None:
            logger.warning('Skipping invalid poster storage path: %s', storage_path)
            continue
        try:
            if poster_path.exists():
                poster_path.unlink()
                deleted += 1
        except OSError:
            logger.warning('Failed to delete poster file %s', poster_path, exc_info=True)
    return deleted
