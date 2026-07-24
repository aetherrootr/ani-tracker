from __future__ import annotations

import hashlib
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.utils.serializers import select_poster_for_user
from app.models import AnimeMetaInfo, AnimePoster, AnimePosterResource, Base
from app.models.progress import UserAnimeProgress
from app.services.anime_poster import (
    build_poster_storage_path,
    download_poster_to_storage,
    upsert_poster_record,
)
from app.services.anime_sync import _poster_ids_to_enqueue


@pytest.fixture()
def db_session() -> Iterator[Session]:
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        yield session
    engine.dispose()


class FakeResponse:
    def __init__(self, content: bytes, content_type: str = 'image/jpeg') -> None:
        self.content = content
        self.headers = {'Content-Type': content_type}

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: Any) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int) -> Iterator[bytes]:
        yield from (
            self.content[index : index + chunk_size]
            for index in range(0, len(self.content), chunk_size)
        )


def create_poster(session: Session, *, status: str = 'pending') -> AnimePoster:
    anime = AnimeMetaInfo(provider_type='bangumi', external_id='1', original_name='Anime')
    source_url = 'https://example.test/poster.jpg'
    resource = AnimePosterResource(
        source_key=hashlib.sha256(source_url.encode()).hexdigest(),
        storage_path=build_poster_storage_path(source_url),
        source_url=source_url,
        status=status,
        mime_type='image/jpeg' if status == 'ready' else '',
        size_bytes=10 if status == 'ready' else 0,
    )
    poster = AnimePoster(
        anime=anime,
        resource=resource,
    )
    session.add(poster)
    session.commit()
    return poster


def download(session: Session, poster: AnimePoster, storage_dir: Path) -> None:
    download_poster_to_storage(
        session,
        poster_id=poster.id,
        storage_dir=str(storage_dir),
        max_bytes=1024,
        timeout=1,
    )


def test_ready_poster_remains_available_while_refresh_is_queued(db_session: Session) -> None:
    poster = create_poster(db_session, status='ready')

    updated = upsert_poster_record(
        db_session,
        anime_id=poster.anime_id,
        source_url=poster.source_url or '',
    )
    ids = _poster_ids_to_enqueue(db_session, anime_id=poster.anime_id, poster=updated)

    assert updated.status == 'ready'
    assert ids == [poster.id]


def test_download_failure_preserves_existing_poster(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    poster = create_poster(db_session, status='ready')
    destination = tmp_path / poster.storage_path
    destination.write_bytes(b'old-poster')

    def fail_download(*_args: Any, **_kwargs: Any) -> None:
        msg = 'offline'
        raise requests.ConnectionError(msg)

    monkeypatch.setattr('app.services.anime_poster.requests.get', fail_download)
    download(db_session, poster, tmp_path)

    db_session.refresh(poster)
    assert destination.read_bytes() == b'old-poster'
    assert poster.status == 'ready'
    assert poster.mime_type == 'image/jpeg'
    assert poster.size_bytes == 10
    assert poster.last_error is None
    assert not [record for record in caplog.records if record.levelno >= 30]


@pytest.mark.parametrize('content', [b'', b'<html>not an image</html>', b'\xff\xd8\xfftruncated'])
def test_invalid_download_does_not_replace_existing_poster(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    content: bytes,
) -> None:
    poster = create_poster(db_session, status='ready')
    destination = tmp_path / poster.storage_path
    destination.write_bytes(b'old-poster')
    monkeypatch.setattr(
        'app.services.anime_poster.requests.get', lambda *_args, **_kwargs: FakeResponse(content),
    )

    download(db_session, poster, tmp_path)

    db_session.refresh(poster)
    assert destination.read_bytes() == b'old-poster'
    assert poster.status == 'ready'
    assert not (tmp_path / f'.tmp-{poster.storage_path}').exists()


def test_valid_download_atomically_replaces_existing_poster(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    poster = create_poster(db_session, status='ready')
    destination = tmp_path / poster.storage_path
    destination.write_bytes(b'old-poster')
    jpeg = b'\xff\xd8\xffnew-poster\xff\xd9'
    monkeypatch.setattr(
        'app.services.anime_poster.requests.get', lambda *_args, **_kwargs: FakeResponse(jpeg),
    )

    download(db_session, poster, tmp_path)

    db_session.refresh(poster)
    assert destination.read_bytes() == jpeg
    assert poster.status == 'ready'
    assert poster.mime_type == 'image/jpeg'
    assert poster.size_bytes == len(jpeg)


def test_invalid_initial_download_is_marked_failed(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    poster = create_poster(db_session)
    monkeypatch.setattr(
        'app.services.anime_poster.requests.get', lambda *_args, **_kwargs: FakeResponse(b''),
    )

    download(db_session, poster, tmp_path)

    db_session.refresh(poster)
    assert poster.status == 'failed'
    assert poster.last_error == 'Poster is empty'
    assert not (tmp_path / poster.storage_path).exists()


def test_same_source_url_is_shared_across_seasons(db_session: Session) -> None:
    first = AnimeMetaInfo(provider_type='tvdb', external_id='321:1', original_name='Season 1')
    second = AnimeMetaInfo(provider_type='tvdb', external_id='321:2', original_name='Season 2')
    db_session.add_all([first, second])
    db_session.flush()

    first_poster = upsert_poster_record(
        db_session,
        anime_id=first.id,
        source_url='https://artworks.thetvdb.com/series.jpg',
        role='series',
        priority=1,
    )
    second_poster = upsert_poster_record(
        db_session,
        anime_id=second.id,
        source_url='https://artworks.thetvdb.com/series.jpg',
        role='series',
        priority=1,
    )

    assert first_poster.id != second_poster.id
    assert first_poster.resource_id == second_poster.resource_id
    assert db_session.query(AnimePosterResource).count() == 1


def test_season_poster_is_default_and_series_poster_is_ready_fallback() -> None:
    season = AnimePoster(
        id=1,
        priority=0,
        role='season',
        resource=AnimePosterResource(
            source_key='season',
            source_url='https://example.test/season.jpg',
            storage_path='season.jpg',
            status='ready',
        ),
    )
    series = AnimePoster(
        id=2,
        priority=1,
        role='series',
        resource=AnimePosterResource(
            source_key='series',
            source_url='https://example.test/series.jpg',
            storage_path='series.jpg',
            status='ready',
        ),
    )
    progress = UserAnimeProgress()

    assert select_poster_for_user([series, season], progress) is season

    season.status = 'failed'
    assert select_poster_for_user([season, series], progress) is series
