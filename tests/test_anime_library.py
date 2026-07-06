from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import create_app
from app.import_provider.factory import ImportProviderFactory
from app.import_provider.types import (
    ImportAnimeDetail,
    ImportAnimeName,
    ImportAnimeSummary,
    ImportEpisodeInfo,
    ImportEpisodeName,
    ImportSearchPage,
)
from app.models.anime import (
    AnimeMetaInfo,
    AnimeName,
    AnimePoster,
    AnimeSummary,
    Episode,
    EpisodeName,
)
from app.models.progress import UserAnimeProgress, UserAnimeStatus, UserEpisodeProgress
from tests.test_auth import register_user


@pytest.fixture()
def app(tmp_path) -> Flask:  # type: ignore[no-untyped-def]
    return create_app(
        {
            'DATABASE_URL': f"sqlite:///{tmp_path / 'test.db'}",
            'SECRET_KEY': 'test-secret',
            'TESTING': True,
            'ANIME_POSTER_STORAGE_DIR': str(tmp_path / 'posters'),
        },
    )


@pytest.fixture()
def client(app: Flask) -> FlaskClient:
    return app.test_client()


@pytest.fixture()
def db_session(app: Flask) -> Iterator[Session]:
    session_factory = app.extensions['db_session_factory']
    with session_factory() as session:
        yield session


class FakeProvider:
    name = 'bangumi'

    def __init__(self) -> None:
        self.detail_calls: list[str] = []

    def search_anime(self, _keyword: str, *, limit: int, offset: int) -> ImportSearchPage:
        return ImportSearchPage(total=0, limit=limit, offset=offset, results=[])

    def get_anime_detail(self, external_id: str) -> ImportAnimeDetail:
        self.detail_calls.append(external_id)
        return ImportAnimeDetail(
            provider='bangumi',
            external_id=external_id,
            title='葬送のフリーレン',
            original_title='葬送のフリーレン',
            summaries=[ImportAnimeSummary(language='zh', summary='summary')],
            poster_source_url='https://example.test/poster.jpg',
            anime_type='tv',
            total_episodes=2,
            url=f'https://bgm.tv/subject/{external_id}',
            names=[ImportAnimeName(name='葬送的芙莉莲', language='zh')],
            episodes=[
                ImportEpisodeInfo(
                    provider='bangumi',
                    external_id='1',
                    episode_number=1,
                    title='旅立ちの終わり',
                    names=[
                        ImportEpisodeName(name='旅立ちの終わり', language='zh'),
                        ImportEpisodeName(name='The Journey Begins', language='en'),
                    ],
                    air_at=datetime(2023, 9, 29, tzinfo=UTC),
                    duration='00:24:00',
                    status='aired',
                    url='https://bgm.tv/ep/1',
                    raw_data={'id': 1},
                ),
                ImportEpisodeInfo(
                    provider='bangumi',
                    external_id='2',
                    episode_number=2,
                    title='別に魔法じゃなくたって...',
                    names=[ImportEpisodeName(name='別に魔法じゃなくたって...', language='ja')],
                    air_at=datetime(2023, 9, 29, tzinfo=UTC),
                    duration='00:24:00',
                    status='aired',
                    url='https://bgm.tv/ep/2',
                    raw_data={'id': 2},
                ),
            ],
            raw_data={'id': int(external_id)},
        )


def install_provider(app: Flask) -> FakeProvider:
    provider = FakeProvider()
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    return provider


def add_library_anime(
    session: Session,
    *,
    user_id: int = 1,
    external_id: str,
    original_name: str,
    names: list[tuple[str, str | None]],
    status: UserAnimeStatus = UserAnimeStatus.PLAN_TO_WATCH,
    air_date: date | None = None,
    updated_at: datetime | None = None,
) -> AnimeMetaInfo:
    anime = AnimeMetaInfo(
        provider_type='bangumi',
        external_id=external_id,
        original_name=original_name,
        total_episodes=12,
        air_date=air_date,
        last_synced_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    session.add(anime)
    session.flush()
    for name, language in names:
        session.add(AnimeName(anime_id=anime.id, name=name, language=language))
    progress = UserAnimeProgress(user_id=user_id, anime_id=anime.id, status=status)
    if updated_at is not None:
        progress.updated_at = updated_at
    session.add(progress)
    session.commit()
    return anime


def test_add_to_library_requires_login(client: FlaskClient) -> None:
    response = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'})

    assert response.status_code == 401
    assert response.get_json() == {'message': 'Authentication required'}


def test_add_to_library_validates_payload(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201

    assert client.post('/api/anime/library', data='bad').status_code == 400
    assert client.post('/api/anime/library', json={'externalId': '493042'}).status_code == 400
    assert client.post('/api/anime/library', json={'provider': 'bangumi'}).status_code == 400
    assert client.post('/api/anime/library', json={'provider': 'unknown', 'externalId': '493042'}).status_code == 400


def test_add_to_library_imports_anime_and_progress(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    provider = install_provider(app)
    assert register_user(client).status_code == 201

    response = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'})

    assert response.status_code == 201
    body = response.get_json()
    assert body['animeCreated'] is True
    assert body['libraryEntryCreatedOrRestored'] is True
    assert body['anime']['posterUrl'] == '/api/anime/library/1/poster'
    assert body['anime']['posterStatus'] == 'pending'
    assert body['progress']['status'] == 'plan_to_watch'
    assert provider.detail_calls == ['493042']
    assert db_session.scalar(select(AnimeMetaInfo).where(AnimeMetaInfo.external_id == '493042')) is not None
    summary = db_session.scalar(select(AnimeSummary))
    poster = db_session.scalar(select(AnimePoster))
    progress = db_session.scalar(select(UserAnimeProgress))
    assert summary is not None
    assert poster is not None
    assert progress is not None
    assert summary.summary == 'summary'
    assert poster.status == 'pending'
    assert len(db_session.scalars(select(Episode)).all()) == 2
    assert len(db_session.scalars(select(EpisodeName)).all()) == 3
    assert progress.status == UserAnimeStatus.PLAN_TO_WATCH


def test_add_to_library_is_idempotent_for_same_user(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    provider = install_provider(app)
    assert register_user(client).status_code == 201

    first = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'})
    second = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'})

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.get_json()['animeCreated'] is False
    assert second.get_json()['libraryEntryCreatedOrRestored'] is False
    assert provider.detail_calls == ['493042']
    assert len(db_session.scalars(select(AnimeMetaInfo)).all()) == 1
    assert len(db_session.scalars(select(AnimeSummary)).all()) == 1
    assert len(db_session.scalars(select(AnimePoster)).all()) == 1
    assert len(db_session.scalars(select(Episode)).all()) == 2
    assert len(db_session.scalars(select(EpisodeName)).all()) == 3
    assert len(db_session.scalars(select(UserAnimeProgress)).all()) == 1


def test_add_to_library_restores_dropped_progress(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    install_provider(app)
    assert register_user(client).status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201
    progress = db_session.scalar(select(UserAnimeProgress))
    assert progress is not None
    progress.status = UserAnimeStatus.DROPPED
    db_session.commit()

    response = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'})

    assert response.status_code == 200
    assert response.get_json()['libraryEntryCreatedOrRestored'] is True
    db_session.refresh(progress)
    assert progress.status == UserAnimeStatus.PLAN_TO_WATCH


def test_episode_list_returns_preferred_episode_name(app: Flask, client: FlaskClient) -> None:
    install_provider(app)
    assert register_user(client, language_preference='en').status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201

    response = client.get('/api/anime/library/1/episodes')

    assert response.status_code == 200
    episodes = response.get_json()['episodes']
    assert episodes[0]['name'] == {'id': 2, 'language': 'en', 'name': 'The Journey Begins'}
    assert episodes[0]['displayName'] == 'The Journey Begins'
    assert episodes[1]['name'] == {'id': 3, 'language': 'ja', 'name': '別に魔法じゃなくたって...'}
    assert episodes[1]['displayName'] == '別に魔法じゃなくたって...'


def test_library_list_returns_wall_display_fields(app: Flask, client: FlaskClient) -> None:
    install_provider(app)
    assert register_user(client, language_preference='zh-CN').status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201
    assert client.patch('/api/anime/library/1/episodes/1/watch-state', json={'watched': True}).status_code == 200

    response = client.get('/api/anime/library')

    assert response.status_code == 200
    item = response.get_json()['items'][0]
    assert item['anime']['name'] == {'id': 1, 'language': 'zh', 'name': '葬送的芙莉莲'}
    assert item['anime']['displayName'] == '葬送的芙莉莲'
    assert item['progress']['status'] == 'watching'
    assert item['progress']['watchedEpisodeCount'] == 1
    assert item['progress']['totalEpisodeCount'] == 2
    assert item['progress']['progressPercent'] == pytest.approx(50.0)


def test_library_list_searches_local_names_with_pinyin_and_returns_name_anchors(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client, language_preference='zh-CN').status_code == 201
    add_library_anime(
        db_session,
        external_id='1',
        original_name='K-ON!',
        names=[('轻音少女', 'zh'), ('K-On!', 'en')],
        status=UserAnimeStatus.WATCHING,
        air_date=date(2009, 4, 3),
    )
    add_library_anime(
        db_session,
        external_id='2',
        original_name='Sousou no Frieren',
        names=[('葬送的芙莉莲', 'zh')],
        status=UserAnimeStatus.PLAN_TO_WATCH,
        air_date=date(2023, 9, 29),
    )

    response = client.get('/api/anime/library?q=qingyin&sort=name&order=asc&limit=1')

    assert response.status_code == 200
    body = response.get_json()
    assert body['total'] == 1
    assert body['items'][0]['anime']['displayName'] == '轻音少女'
    assert body['navigationAnchors'] == [{'key': 'q', 'label': 'Q', 'offset': 0, 'page': 1}]


def test_library_list_filters_status_and_rejects_dropped(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    add_library_anime(
        db_session,
        external_id='1',
        original_name='Visible',
        names=[('Visible', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    add_library_anime(
        db_session,
        external_id='2',
        original_name='Hidden',
        names=[('Hidden', 'en')],
        status=UserAnimeStatus.DROPPED,
    )

    response = client.get('/api/anime/library')
    watching_response = client.get('/api/anime/library?status=watching')
    dropped_response = client.get('/api/anime/library?status=dropped')

    assert response.status_code == 200
    assert response.get_json()['total'] == 1
    assert watching_response.status_code == 200
    assert watching_response.get_json()['items'][0]['anime']['displayName'] == 'Visible'
    assert dropped_response.status_code == 400


def test_library_list_sorts_air_date_and_returns_month_anchors(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    add_library_anime(
        db_session,
        external_id='1',
        original_name='Older',
        names=[('Older', 'en')],
        air_date=date(2023, 9, 29),
    )
    add_library_anime(
        db_session,
        external_id='2',
        original_name='Newer',
        names=[('Newer', 'en')],
        air_date=date(2024, 2, 1),
    )

    response = client.get('/api/anime/library?sort=air_date&order=desc&limit=20')

    assert response.status_code == 200
    body = response.get_json()
    assert [item['anime']['displayName'] for item in body['items']] == ['Newer', 'Older']
    assert body['navigationAnchors'] == [
        {'key': '2024-02', 'label': '2024-02', 'offset': 0, 'page': 1},
        {'key': '2023-09', 'label': '2023-09', 'offset': 1, 'page': 1},
    ]


def test_anime_detail_returns_available_names_air_date_and_posters(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='1',
        original_name='K-ON!',
        names=[('轻音少女', 'zh'), ('K-On!', 'en')],
        air_date=date(2009, 4, 3),
    )
    db_session.add_all(
        [
            AnimePoster(anime_id=anime.id, storage_path='failed.jpg', status='failed'),
            AnimePoster(anime_id=anime.id, storage_path='ready.jpg', status='ready'),
        ],
    )
    db_session.commit()

    response = client.get(f'/api/anime/{anime.id}')

    assert response.status_code == 200
    body = response.get_json()['anime']
    assert body['airDate'] == '2009-04-03'
    assert body['availableNames'] == [
        {'id': 1, 'language': 'zh', 'name': '轻音少女'},
        {'id': 2, 'language': 'en', 'name': 'K-On!'},
    ]
    assert body['poster']['id'] == 2
    assert body['posterUrl'] == f'/api/anime/library/{anime.id}/poster'
    assert [poster['url'] for poster in body['availablePosters']] == [
        f'/api/anime/library/{anime.id}/posters/1',
        f'/api/anime/library/{anime.id}/posters/2',
    ]


def test_anime_name_preference_can_be_set_and_validates_name_owner(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client, language_preference='zh-CN').status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='1',
        original_name='K-ON!',
        names=[('轻音少女', 'zh'), ('K-On!', 'en')],
    )
    other = add_library_anime(
        db_session,
        external_id='2',
        original_name='Other',
        names=[('Other', 'en')],
    )

    response = client.patch(f'/api/anime/library/{anime.id}/name-preference', json={'nameId': 2})
    invalid_response = client.patch(f'/api/anime/library/{anime.id}/name-preference', json={'nameId': other.names[0].id})
    detail_response = client.get(f'/api/anime/{anime.id}')

    assert response.status_code == 200
    assert response.get_json() == {
        'name': {'id': 2, 'language': 'en', 'name': 'K-On!'},
        'progress': {'id': 1, 'animeId': anime.id, 'preferredNameId': 2},
    }
    assert invalid_response.status_code == 400
    assert detail_response.get_json()['anime']['displayName'] == 'K-On!'


def test_episode_name_preference_can_be_set_without_marking_watched(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    install_provider(app)
    assert register_user(client, language_preference='zh-CN').status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201

    response = client.patch('/api/anime/library/1/episodes/1/name-preference', json={'nameId': 2})
    episodes_response = client.get('/api/anime/library/1/episodes')

    assert response.status_code == 200
    assert response.get_json() == {
        'name': {'id': 2, 'language': 'en', 'name': 'The Journey Begins'},
        'episode': {'id': 1, 'animeId': 1, 'preferredNameId': 2},
    }
    first_episode = episodes_response.get_json()['episodes'][0]
    assert first_episode['displayName'] == 'The Journey Begins'
    assert first_episode['watched'] is False
    episode_progress = db_session.scalar(select(UserEpisodeProgress))
    assert episode_progress is not None
    assert episode_progress.watched is False


def test_poster_preference_can_be_set_and_cleared(app: Flask, client: FlaskClient) -> None:
    install_provider(app)
    assert register_user(client).status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201

    response = client.patch('/api/anime/library/1/poster-preference', json={'posterId': 1})

    assert response.status_code == 200
    assert response.get_json() == {
        'poster': {
            'id': 1,
            'status': 'pending',
            'url': '/api/anime/library/1/poster',
            'isPreferred': True,
        },
        'progress': {'id': 1, 'animeId': 1, 'preferredPosterId': 1},
    }

    clear_response = client.patch('/api/anime/library/1/poster-preference', json={'posterId': None})

    assert clear_response.status_code == 200
    assert clear_response.get_json() == {
        'poster': None,
        'progress': {'id': 1, 'animeId': 1, 'preferredPosterId': None},
    }


def test_poster_preference_rejects_invalid_poster(app: Flask, client: FlaskClient) -> None:
    install_provider(app)
    assert register_user(client).status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201

    response = client.patch('/api/anime/library/1/poster-preference', json={'posterId': 999})

    assert response.status_code == 400
    assert response.get_json() == {'message': 'posterId is invalid'}
