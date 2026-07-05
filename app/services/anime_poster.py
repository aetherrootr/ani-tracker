from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse

import requests
from flask import current_app
from sqlalchemy.orm import Session

from app.models.anime import AnimePoster

logger = logging.getLogger(__name__)

ALLOWED_MIME_TYPES = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}


def build_poster_storage_path(provider: str, external_id: str, source_url: str) -> str:
    digest = hashlib.sha256(f'{provider}:{external_id}:{source_url}'.encode()).hexdigest()[:16]
    suffix = Path(urlparse(source_url).path).suffix.lower()
    if suffix not in {'.jpg', '.jpeg', '.png', '.webp'}:
        suffix = '.jpg'
    if suffix == '.jpeg':
        suffix = '.jpg'
    return f'{provider}-{external_id}-{digest}{suffix}'


def upsert_poster_record(
    session: Session,
    *,
    anime_id: int,
    provider: str,
    external_id: str,
    source_url: str,
) -> AnimePoster:
    storage_path = build_poster_storage_path(provider, external_id, source_url)
    poster = session.query(AnimePoster).filter(AnimePoster.anime_id == anime_id).one_or_none()
    if poster is None:
        poster = AnimePoster(anime_id=anime_id, storage_path=storage_path)
        session.add(poster)
    poster.storage_path = storage_path
    poster.source_url = source_url
    poster.status = 'pending'
    poster.last_error = None
    return poster


def resolve_poster_path(storage_dir: str, storage_path: str) -> Path | None:
    base = Path(storage_dir).resolve()
    candidate = (base / storage_path).resolve()
    if candidate == base or base not in candidate.parents:
        return None
    return candidate


def download_poster_to_storage(
    session: Session,
    *,
    poster_id: int,
    storage_dir: str,
    max_bytes: int,
    timeout: float,
) -> None:
    poster = session.get(AnimePoster, poster_id)
    if poster is None or not poster.source_url:
        return

    destination = resolve_poster_path(storage_dir, poster.storage_path)
    if destination is None:
        _mark_failed(session, poster, 'Invalid poster storage path')
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destination.with_name(f'.tmp-{destination.name}')

    try:
        with requests.get(poster.source_url, stream=True, timeout=timeout) as response:
            response.raise_for_status()
            mime_type = response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if mime_type not in ALLOWED_MIME_TYPES:
                guessed = mimetypes.guess_type(poster.source_url)[0]
                mime_type = guessed if guessed in ALLOWED_MIME_TYPES else mime_type
            if mime_type not in ALLOWED_MIME_TYPES:
                msg = f'Unsupported poster MIME type: {mime_type or "unknown"}'
                raise ValueError(msg)

            size = 0
            with tmp_path.open('wb') as output:
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > max_bytes:
                        msg = 'Poster exceeds maximum size'
                        raise ValueError(msg)
                    output.write(chunk)
        os.replace(tmp_path, destination)
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        logger.warning('Poster download failed for poster %s', poster_id, exc_info=exc)
        _mark_failed(session, poster, str(exc)[:1024])
        return

    poster.mime_type = mime_type
    poster.size_bytes = size
    poster.status = 'ready'
    poster.last_error = None
    session.commit()


def enqueue_poster_download(poster_id: int) -> None:
    from app.tasks.anime_poster import download_anime_poster

    try:
        download_anime_poster.delay(
            poster_id,
            current_app.config['DATABASE_URL'],
            current_app.config['ANIME_POSTER_STORAGE_DIR'],
            int(current_app.config['ANIME_POSTER_MAX_BYTES']),
            float(current_app.config['ANIME_POSTER_REQUEST_TIMEOUT']),
        )
    except Exception as exc:
        logger.warning('Failed to enqueue poster download task', exc_info=exc)


def _mark_failed(session: Session, poster: AnimePoster, error: str) -> None:
    poster.status = 'failed'
    poster.last_error = error[:1024]
    session.commit()
