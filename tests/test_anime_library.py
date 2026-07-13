from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import create_app
from app.celery_app import celery_app
from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import ImportProviderResponseError, ImportProviderTimeoutError
from app.import_provider.factory import ImportProviderFactory
from app.import_provider.types import (
    ImportAnimeDetail,
    ImportAnimeName,
    ImportAnimeSummary,
    ImportEpisodeInfo,
    ImportEpisodeName,
    ImportRelatedAnime,
    ImportSearchPage,
)
from app.models.anime import (
    AnimeMetaInfo,
    AnimeName,
    AnimePoster,
    AnimeRelation,
    AnimeSummary,
    Episode,
    EpisodeName,
    EpisodeStatus,
)
from app.models.progress import (
    UserAnimeProgress,
    UserAnimeRelationOverride,
    UserAnimeStatus,
    UserEpisodeProgress,
)
from app.tasks.celery_config import configure_celery
from tests.test_auth import register_user


@pytest.fixture()
def app(test_instance_path) -> Flask:  # type: ignore[no-untyped-def]
    return create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'test.db'}",
            'SECRET_KEY': 'test-secret',
            'TESTING': True,
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


class FakeProvider(ImportProvider):
    name = 'bangumi'

    def __init__(self) -> None:
        self.detail_calls: list[str] = []

    def search_anime(self, _keyword: str, *, limit: int, offset: int, language: str | None = None) -> ImportSearchPage:
        _ = language
        return ImportSearchPage(total=0, limit=limit, offset=offset, results=[])

    def get_anime_detail(self, external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
        _ = language
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


class MutableDetailProvider(FakeProvider):
    def __init__(self, details: dict[str, ImportAnimeDetail]) -> None:
        super().__init__()
        self.details = details

    def get_anime_detail(self, external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
        _ = language
        self.detail_calls.append(external_id)
        detail = self.details.get(external_id)
        if detail is None:
            message = 'missing fake detail'
            raise ImportProviderResponseError(message)
        return detail


class NamedMutableDetailProvider(MutableDetailProvider):
    def __init__(self, name: str, details: dict[str, ImportAnimeDetail]) -> None:
        super().__init__(details)
        self.name = name


def anime_detail(
    external_id: str,
    *,
    title: str = 'Updated Anime',
    summaries: list[ImportAnimeSummary] | None = None,
    names: list[ImportAnimeName] | None = None,
    episodes: list[ImportEpisodeInfo] | None = None,
    total_episodes: int | None = 2,
) -> ImportAnimeDetail:
    return ImportAnimeDetail(
        provider='bangumi',
        external_id=external_id,
        title=title,
        original_title=title,
        summaries=summaries if summaries is not None else [ImportAnimeSummary(language='zh', summary='updated summary')],
        poster_source_url='https://example.test/updated.jpg',
        anime_type='tv',
        total_episodes=total_episodes,
        url=f'https://bgm.tv/subject/{external_id}',
        names=names if names is not None else [ImportAnimeName(name='Updated Name', language='en')],
        episodes=episodes if episodes is not None else [episode_info(1, title='Updated Episode 1'), episode_info(2)],
        raw_data={'id': external_id},
        air_date=date(2024, 4, 1),
    )


def episode_info(
    number: int,
    *,
    title: str | None = None,
    status: str = 'aired',
    air_at: datetime | None = None,
) -> ImportEpisodeInfo:
    return ImportEpisodeInfo(
        provider='bangumi',
        external_id=str(number),
        episode_number=number,
        title=title or f'Updated Episode {number}',
        names=[ImportEpisodeName(name=f'Updated Episode {number}', language='en')],
        air_at=air_at or datetime(2024, 4, number, tzinfo=UTC),
        duration='00:25:00',
        status=status,
        url=f'https://bgm.tv/ep/{number}',
        raw_data={'id': number},
    )


def install_provider(app: Flask) -> FakeProvider:
    provider = FakeProvider()
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    return provider


def add_library_anime(
    session: Session,
    *,
    user_id: int = 1,
    provider_type: str = 'bangumi',
    external_id: str,
    original_name: str,
    names: list[tuple[str, str | None]],
    status: UserAnimeStatus = UserAnimeStatus.PLAN_TO_WATCH,
    air_date: date | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> AnimeMetaInfo:
    anime = AnimeMetaInfo(
        provider_type=provider_type,
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
    if created_at is not None:
        progress.created_at = created_at
    if updated_at is not None:
        progress.updated_at = updated_at
    session.add(progress)
    session.commit()
    return anime


def add_episode(
    session: Session,
    anime: AnimeMetaInfo,
    *,
    number: int,
    status: EpisodeStatus = EpisodeStatus.AIRED,
    air_at: datetime | None = None,
    title: str | None = None,
    duration: str | None = None,
) -> Episode:
    episode = Episode(
        anime_id=anime.id,
        episode_number=number,
        original_title=title or f'Episode {number}',
        air_at=air_at,
        duration=duration,
        status=status,
    )
    session.add(episode)
    session.flush()
    return episode


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
    assert body['anime']['posterUrl'] == '/api/anime/1/assets/poster?v=1-pending'
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


def test_add_to_library_reuses_episode_when_provider_returns_duplicate_numbers(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    provider = MutableDetailProvider(
        {
            '493042': anime_detail(
                '493042',
                episodes=[
                    episode_info(9, title='Episode 9'),
                    episode_info(9, title='Mini Anime #7'),
                ],
                total_episodes=1,
            ),
        },
    )
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})

    response = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'})

    assert response.status_code == 201
    episodes = db_session.scalars(select(Episode)).all()
    assert len(episodes) == 1
    assert episodes[0].episode_number == 9
    assert episodes[0].original_title == 'Mini Anime #7'


def test_add_to_library_detects_duplicate_against_existing_anime_alias(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    existing = AnimeMetaInfo(
        provider_type='tvdb',
        external_id='371310:1',
        original_name='无职转生～到了异世界就拿出真本事～ Season 1',  # noqa: RUF001
        total_episodes=23,
    )
    db_session.add(existing)
    db_session.flush()
    db_session.add(AnimeName(anime_id=existing.id, name='无职转生～到了异世界就拿出真本事～', language='zho'))  # noqa: RUF001
    db_session.add(UserAnimeProgress(user_id=1, anime_id=existing.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()
    provider = MutableDetailProvider(
        {
            '277554': anime_detail(
                '277554',
                title='無職転生 ～異世界行ったら本気だす～',  # noqa: RUF001
                names=[ImportAnimeName(name='无职转生～到了异世界就拿出真本事～', language='zh')],  # noqa: RUF001
            ),
        },
    )
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})

    response = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '277554'})

    assert response.status_code == 409
    conflict = response.get_json()['conflict']
    assert conflict['provider'] == 'bangumi'
    assert conflict['externalId'] == '277554'
    assert conflict['candidates'][0]['animeId'] == existing.id
    assert conflict['candidates'][0]['provider'] == 'tvdb'
    assert db_session.scalar(select(AnimeMetaInfo).where(AnimeMetaInfo.external_id == '277554')) is None


def test_provider_switch_retargets_existing_related_anime_links(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current Anime')
    source = AnimeMetaInfo(provider_type='bangumi', external_id='old-related', original_name='Related Anime')
    db_session.add_all([current, source])
    db_session.flush()
    source_poster = AnimePoster(anime_id=source.id, storage_path='old-related.jpg', status='ready')
    db_session.add(source_poster)
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='bangumi',
        external_id='old-related',
        relation_type='same_series_season',
        title='Related Anime',
        related_anime_id=source.id,
        poster_id=source_poster.id,
    )
    db_session.add(relation)
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=source.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()
    target_detail = replace(
        anime_detail('new-related', title='Related Anime TVDB'),
        provider='tvdb',
        url='https://thetvdb.com/series/related/seasons/official/1',
        poster_source_url='https://example.test/new-related.jpg',
    )
    provider = NamedMutableDetailProvider('tvdb', {'new-related': target_detail})
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': FakeProvider(), 'tvdb': provider})

    switch_response = client.post(
        f'/api/anime/library/{source.id}/provider-switch',
        json={'provider': 'tvdb', 'externalId': 'new-related'},
    )

    assert switch_response.status_code == 200
    target_id = switch_response.get_json()['anime']['id']
    detail_response = client.get(f'/api/anime/{current.id}')
    related = detail_response.get_json()['anime']['relatedAnime'][0]
    assert related['animeId'] == target_id
    assert related['inLibrary'] is True
    assert related['posterUrl'] == f'/api/anime/{target_id}/assets/posters/2?v=2-pending'
    db_session.refresh(relation)
    assert relation.related_anime_id == source.id
    override = db_session.scalar(select(UserAnimeRelationOverride).where(UserAnimeRelationOverride.anime_relation_id == relation.id))
    assert override is not None
    assert override.user_id == 1
    assert override.related_anime_id == target_id


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


def test_single_episode_uses_anime_air_date_when_episode_air_time_missing(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    class SingleEpisodeProvider(FakeProvider):
        def get_anime_detail(self, external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
            _ = language
            self.detail_calls.append(external_id)
            return ImportAnimeDetail(
                provider='bangumi',
                external_id=external_id,
                title='Ghost in the Shell SAC_2045 Movie',
                original_title='攻殻機動隊 SAC_2045 持続可能戦争',
                summaries=[],
                poster_source_url=None,
                anime_type='movie',
                total_episodes=1,
                url=f'https://bgm.tv/subject/{external_id}',
                names=[],
                episodes=[
                    ImportEpisodeInfo(
                        provider='bangumi',
                        external_id='1',
                        episode_number=1,
                        title='Sustainable War',
                        names=[],
                        air_at=None,
                        duration='01:58:00',
                        status='unknown',
                        url='https://bgm.tv/ep/1',
                        raw_data={'id': 1},
                    ),
                ],
                raw_data={'id': int(external_id)},
                air_date=date(2021, 11, 12),
            )

    provider = SingleEpisodeProvider()
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    assert register_user(client).status_code == 201

    response = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '1'})

    assert response.status_code == 201
    episode = db_session.scalar(select(Episode))
    assert episode is not None
    assert episode.air_at is not None
    assert episode.air_at.date() == date(2021, 11, 12)
    assert episode.status.value == 'aired'


def test_single_movie_episode_without_title_uses_anime_title(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    class SingleMovieProvider(FakeProvider):
        def get_anime_detail(self, external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
            _ = language
            self.detail_calls.append(external_id)
            return ImportAnimeDetail(
                provider='bangumi',
                external_id=external_id,
                title='Ghost in the Shell SAC_2045 Sustainable War',
                original_title='攻殻機動隊 SAC_2045 持続可能戦争',
                summaries=[],
                poster_source_url=None,
                anime_type='movie',
                total_episodes=1,
                url=f'https://bgm.tv/subject/{external_id}',
                names=[],
                episodes=[
                    ImportEpisodeInfo(
                        provider='bangumi',
                        external_id='1',
                        episode_number=1,
                        title=None,
                        names=[],
                        air_at=None,
                        duration='01:58:00',
                        status='unknown',
                        url='https://bgm.tv/ep/1',
                        raw_data={'id': 1},
                    ),
                ],
                raw_data={'id': int(external_id)},
                air_date=date(2021, 11, 12),
            )

    provider = SingleMovieProvider()
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    assert register_user(client).status_code == 201

    response = client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '2'})

    assert response.status_code == 201
    episode = db_session.scalar(select(Episode))
    assert episode is not None
    assert episode.original_title == 'Ghost in the Shell SAC_2045 Sustainable War'
    episode_names = db_session.scalars(select(EpisodeName).where(EpisodeName.episode_id == episode.id)).all()
    assert [name.name for name in episode_names] == ['Ghost in the Shell SAC_2045 Sustainable War']


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
    assert client.patch('/api/watch-state/anime/1/episodes/1', json={'watched': True}).status_code == 200

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


def test_library_list_search_requires_relevant_phrase_and_sorts_by_relevance(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    add_library_anime(
        db_session,
        external_id='1',
        original_name='Love Is War',
        names=[('Love Is War', 'en')],
        created_at=datetime(2024, 3, 1, tzinfo=UTC),
    )
    add_library_anime(
        db_session,
        external_id='2',
        original_name='Love Live! Superstar!!',
        names=[('Love Live! Superstar!!', 'en')],
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    add_library_anime(
        db_session,
        external_id='3',
        original_name='Superstar Love Live',
        names=[('Superstar Love Live', 'en')],
        created_at=datetime(2024, 2, 1, tzinfo=UTC),
    )

    response = client.get('/api/anime/library?q=love%20live&sort=updated_at&order=desc')

    assert response.status_code == 200
    body = response.get_json()
    assert [item['anime']['displayName'] for item in body['items']] == [
        'Love Live! Superstar!!',
        'Superstar Love Live',
    ]


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


def test_library_list_filters_provider_and_returns_available_providers(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    add_library_anime(
        db_session,
        provider_type='bangumi',
        external_id='1',
        original_name='Bangumi Anime',
        names=[('Bangumi Anime', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    add_library_anime(
        db_session,
        provider_type='tmdb',
        external_id='2',
        original_name='TMDB Anime',
        names=[('TMDB Anime', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    add_library_anime(
        db_session,
        provider_type='tvdb',
        external_id='3',
        original_name='Dropped Anime',
        names=[('Dropped Anime', 'en')],
        status=UserAnimeStatus.DROPPED,
    )

    response = client.get('/api/anime/library?provider=tmdb')

    assert response.status_code == 200
    body = response.get_json()
    assert body['total'] == 1
    assert body['items'][0]['anime']['provider'] == 'tmdb'
    assert body['providers'] == [
        {'name': 'bangumi', 'label': 'Bangumi'},
        {'name': 'tmdb', 'label': 'TMDB'},
    ]


def test_library_list_filters_tracking_and_backlog_lists(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)
    tracking = add_library_anime(
        db_session,
        external_id='tracking-filter',
        original_name='Tracking Filter',
        names=[('Tracking Filter', 'en')],
    )
    add_episode(db_session, tracking, number=1, air_at=now - timedelta(days=1))
    add_episode(db_session, tracking, number=2, status=EpisodeStatus.UPCOMING, air_at=now + timedelta(days=1))
    backlog = add_library_anime(
        db_session,
        external_id='backlog-filter',
        original_name='Backlog Filter',
        names=[('Backlog Filter', 'en')],
        air_date=date(2020, 1, 1),
    )
    backlog.total_episodes = 1
    add_episode(db_session, backlog, number=1, air_at=now - timedelta(days=120))
    db_session.commit()

    tracking_response = client.get('/api/anime/library?list=tracking&sort=name&order=asc')
    backlog_response = client.get('/api/anime/library?list=backlog&sort=name&order=asc')
    invalid_response = client.get('/api/anime/library?list=recently-watched')

    assert tracking_response.status_code == 200
    assert [item['anime']['displayName'] for item in tracking_response.get_json()['items']] == ['Tracking Filter']
    assert backlog_response.status_code == 200
    assert [item['anime']['displayName'] for item in backlog_response.get_json()['items']] == ['Backlog Filter']
    assert invalid_response.status_code == 400


def test_library_list_filters_season_zero_records(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    add_library_anime(
        db_session,
        provider_type='tvdb',
        external_id='321:0',
        original_name='TVDB Specials',
        names=[('TVDB Specials', 'en')],
    )
    add_library_anime(
        db_session,
        provider_type='tmdb',
        external_id='tv:123:season:0',
        original_name='TMDB Specials',
        names=[('TMDB Specials', 'en')],
    )
    add_library_anime(
        db_session,
        provider_type='tvdb',
        external_id='321:1',
        original_name='TVDB Season One',
        names=[('TVDB Season One', 'en')],
    )

    default_response = client.get('/api/anime/library?sort=name&order=asc')
    include_response = client.get('/api/anime/library?seasonZero=include&sort=name&order=asc')
    only_response = client.get('/api/anime/library?seasonZero=only&sort=name&order=asc')
    invalid_response = client.get('/api/anime/library?seasonZero=hidden')

    assert default_response.status_code == 200
    assert [item['anime']['displayName'] for item in default_response.get_json()['items']] == ['TVDB Season One']
    assert include_response.status_code == 200
    assert [item['anime']['displayName'] for item in include_response.get_json()['items']] == [
        'TMDB Specials',
        'TVDB Season One',
        'TVDB Specials',
    ]
    assert only_response.status_code == 200
    assert [item['anime']['displayName'] for item in only_response.get_json()['items']] == [
        'TMDB Specials',
        'TVDB Specials',
    ]
    assert invalid_response.status_code == 400


def test_library_list_updated_at_sort_uses_added_time(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    add_library_anime(
        db_session,
        external_id='1',
        original_name='Added Earlier Updated Later',
        names=[('Added Earlier Updated Later', 'en')],
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
        updated_at=datetime(2024, 3, 1, tzinfo=UTC),
    )
    add_library_anime(
        db_session,
        external_id='2',
        original_name='Added Later Updated Earlier',
        names=[('Added Later Updated Earlier', 'en')],
        created_at=datetime(2024, 2, 1, tzinfo=UTC),
        updated_at=datetime(2024, 1, 15, tzinfo=UTC),
    )

    response = client.get('/api/anime/library?sort=updated_at&order=desc')

    assert response.status_code == 200
    assert [item['anime']['displayName'] for item in response.get_json()['items']] == [
        'Added Later Updated Earlier',
        'Added Earlier Updated Later',
    ]


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


def test_library_list_air_date_anchors_include_unknown(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    add_library_anime(
        db_session,
        external_id='1',
        original_name='Known',
        names=[('Known', 'en')],
        air_date=date(2024, 2, 1),
    )
    add_library_anime(
        db_session,
        external_id='2',
        original_name='Unknown',
        names=[('Unknown', 'en')],
        air_date=None,
    )

    response = client.get('/api/anime/library?sort=air_date&order=desc&limit=20')

    assert response.status_code == 200
    body = response.get_json()
    assert body['navigationAnchors'] == [
        {'key': '2024-02', 'label': '2024-02', 'offset': 0, 'page': 1},
        {'key': 'unknown', 'label': 'Unknown', 'offset': 1, 'page': 1},
    ]


def test_tracking_list_returns_next_episodes_recently_watched_and_excludes_dropped(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)

    airing = add_library_anime(
        db_session,
        external_id='tracking-airing',
        original_name='Airing Show',
        names=[('Airing Show', 'en')],
        air_date=date(2026, 7, 1),
    )
    airing_ep1 = add_episode(db_session, airing, number=1, air_at=now - timedelta(days=14), title='Airing 1')
    add_episode(db_session, airing, number=2, air_at=now - timedelta(days=1), title='Airing 2')
    add_episode(db_session, airing, number=3, status=EpisodeStatus.UPCOMING, air_at=now + timedelta(days=6))

    finished_recently = add_library_anime(
        db_session,
        external_id='tracking-buffer',
        original_name='Recently Finished',
        names=[('Recently Finished', 'en')],
        air_date=date(2026, 6, 1),
    )
    finished_recently.total_episodes = 2
    finished_recently_ep1 = add_episode(db_session, finished_recently, number=1, air_at=now - timedelta(days=17))
    add_episode(db_session, finished_recently, number=2, air_at=now - timedelta(days=10))

    finished_old = add_library_anime(
        db_session,
        external_id='backlog-old',
        original_name='Old Finished',
        names=[('Old Finished', 'en')],
        air_date=date(2020, 4, 1),
    )
    finished_old.total_episodes = 3
    finished_old_ep1 = add_episode(db_session, finished_old, number=1, air_at=now - timedelta(days=100), title='Old 1')
    add_episode(db_session, finished_old, number=2, air_at=now - timedelta(days=99), title='Old 2')
    add_episode(db_session, finished_old, number=3, air_at=now - timedelta(days=98), title='Old 3')

    caught_up = add_library_anime(
        db_session,
        external_id='caught-up',
        original_name='Caught Up',
        names=[('Caught Up', 'en')],
        air_date=date(2026, 7, 2),
    )
    caught_up_ep1 = add_episode(db_session, caught_up, number=1, air_at=now - timedelta(days=2))
    add_episode(db_session, caught_up, number=2, status=EpisodeStatus.UPCOMING, air_at=now + timedelta(days=5))

    dropped = add_library_anime(
        db_session,
        external_id='dropped',
        original_name='Dropped Show',
        names=[('Dropped Show', 'en')],
        status=UserAnimeStatus.DROPPED,
        air_date=date(2026, 7, 3),
    )
    add_episode(db_session, dropped, number=1, air_at=now - timedelta(days=1))
    dropped_ep2 = add_episode(db_session, dropped, number=2, air_at=now, title='Dropped 2')

    db_session.add_all(
        [
            UserEpisodeProgress(user_id=1, episode_id=airing_ep1.id, watched=True, watched_at=now - timedelta(hours=3)),
            UserEpisodeProgress(
                user_id=1,
                episode_id=finished_recently_ep1.id,
                watched=True,
                watched_at=now - timedelta(hours=2),
            ),
            UserEpisodeProgress(user_id=1, episode_id=finished_old_ep1.id, watched=True, watched_at=now - timedelta(hours=1)),
            UserEpisodeProgress(user_id=1, episode_id=caught_up_ep1.id, watched=True, watched_at=now - timedelta(hours=4)),
            UserEpisodeProgress(user_id=1, episode_id=dropped_ep2.id, watched=True, watched_at=now),
        ],
    )
    db_session.commit()

    tracking_response = client.get('/api/watch-state/tracking-list/tracking')
    backlog_response = client.get('/api/watch-state/tracking-list/backlog')
    recent_response = client.get('/api/watch-state/tracking-list/recently-watched')

    assert tracking_response.status_code == 200
    tracking_body = tracking_response.get_json()
    assert [item['anime']['displayName'] for item in tracking_body['items']] == ['Airing Show', 'Recently Finished']
    assert [item['episode']['episodeNumber'] for item in tracking_body['items']] == [2, 2]
    assert tracking_body['total'] == 2
    assert tracking_body['limit'] == 20
    assert tracking_body['offset'] == 0
    assert tracking_body['hasMore'] is False
    assert all(item['episode']['watched'] is False for item in tracking_body['items'])
    assert tracking_body['items'][0]['watchedEpisodeCount'] == 1
    assert tracking_body['items'][0]['airedEpisodeCount'] == 2

    assert backlog_response.status_code == 200
    backlog_body = backlog_response.get_json()
    assert [item['anime']['displayName'] for item in backlog_body['items']] == ['Old Finished']
    assert backlog_body['total'] == 1
    assert backlog_body['limit'] == 20
    assert backlog_body['offset'] == 0
    assert backlog_body['hasMore'] is False
    assert backlog_body['items'][0]['episode']['episodeNumber'] == 2
    assert backlog_body['items'][0]['episode']['displayName'] == 'Old 2'

    assert recent_response.status_code == 200
    recent_body = recent_response.get_json()
    assert [item['anime']['displayName'] for item in recent_body['items']] == [
        'Old Finished',
        'Recently Finished',
        'Airing Show',
        'Caught Up',
    ]
    assert recent_body['total'] == 4
    assert recent_body['limit'] == 15
    assert recent_body['offset'] == 0
    assert recent_body['hasMore'] is False
    assert all(item['episode']['watched'] is True for item in recent_body['items'])

    paged_recent_response = client.get('/api/watch-state/tracking-list/recently-watched?limit=2&offset=1')

    assert paged_recent_response.status_code == 200
    paged_recent_body = paged_recent_response.get_json()
    assert [item['anime']['displayName'] for item in paged_recent_body['items']] == ['Recently Finished', 'Airing Show']
    assert paged_recent_body['total'] == 4
    assert paged_recent_body['limit'] == 2
    assert paged_recent_body['offset'] == 1
    assert paged_recent_body['hasMore'] is True


def test_tracking_list_paginates_tracking_items(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)
    for index in range(3):
        anime = add_library_anime(
            db_session,
            external_id=f'tracking-{index}',
            original_name=f'Tracking {index}',
            names=[(f'Tracking {index}', 'en')],
        )
        add_episode(db_session, anime, number=1, air_at=now - timedelta(days=index + 1))
        add_episode(db_session, anime, number=2, status=EpisodeStatus.UPCOMING, air_at=now + timedelta(days=index + 1))
    db_session.commit()

    response = client.get('/api/watch-state/tracking-list/tracking?limit=1&offset=1')
    invalid_limit_response = client.get('/api/watch-state/tracking-list/tracking?limit=0')
    invalid_offset_response = client.get('/api/watch-state/tracking-list/tracking?offset=-1')

    assert response.status_code == 200
    body = response.get_json()
    assert [item['anime']['displayName'] for item in body['items']] == ['Tracking 1']
    assert body['total'] == 3
    assert body['limit'] == 1
    assert body['offset'] == 1
    assert body['hasMore'] is True
    assert invalid_limit_response.status_code == 400
    assert invalid_offset_response.status_code == 400


def test_tracking_list_paginates_backlog_items(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)
    for index in range(3):
        anime = add_library_anime(
            db_session,
            external_id=f'backlog-{index}',
            original_name=f'Backlog {index}',
            names=[(f'Backlog {index}', 'en')],
            air_date=date(2020, 1, index + 1),
        )
        anime.total_episodes = 1
        add_episode(db_session, anime, number=1, air_at=now - timedelta(days=100 + index))
    db_session.commit()

    response = client.get('/api/watch-state/tracking-list/backlog?limit=1&offset=1')
    invalid_limit_response = client.get('/api/watch-state/tracking-list/backlog?limit=0')
    invalid_offset_response = client.get('/api/watch-state/tracking-list/backlog?offset=-1')

    assert response.status_code == 200
    body = response.get_json()
    assert [item['anime']['displayName'] for item in body['items']] == ['Backlog 1']
    assert body['total'] == 3
    assert body['limit'] == 1
    assert body['offset'] == 1
    assert body['hasMore'] is True
    assert invalid_limit_response.status_code == 400
    assert invalid_offset_response.status_code == 400


def test_statistics_summary_counts_duration_user_isolation_and_dropped(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)
    visible = add_library_anime(
        db_session,
        external_id='stats-visible',
        original_name='Stats Visible',
        names=[('Stats Visible', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    watched = add_episode(db_session, visible, number=1, duration='00:24:00')
    invalid_duration = add_episode(db_session, visible, number=2)
    unwatched = add_episode(db_session, visible, number=3, duration='00:25:00')
    dropped = add_library_anime(
        db_session,
        external_id='stats-dropped',
        original_name='Stats Dropped',
        names=[('Stats Dropped', 'en')],
        status=UserAnimeStatus.DROPPED,
    )
    dropped_episode = add_episode(db_session, dropped, number=1, duration='00:24:00')
    other_user_anime = add_library_anime(
        db_session,
        user_id=2,
        external_id='other-user',
        original_name='Other User',
        names=[('Other User', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    other_user_episode = add_episode(db_session, other_user_anime, number=1, duration='00:24:00')
    assert unwatched.status == EpisodeStatus.AIRED
    db_session.add_all(
        [
            UserEpisodeProgress(user_id=1, episode_id=watched.id, watched=True, watched_at=now),
            UserEpisodeProgress(user_id=1, episode_id=invalid_duration.id, watched=True, watched_at=now),
            UserEpisodeProgress(user_id=1, episode_id=dropped_episode.id, watched=True, watched_at=now),
            UserEpisodeProgress(user_id=2, episode_id=other_user_episode.id, watched=True, watched_at=now),
        ],
    )
    db_session.commit()

    response = client.get('/api/statistics/summary')

    assert response.status_code == 200
    body = response.get_json()
    assert body['status'] == 'ready'
    assert body['watchedEpisodeCount'] == 2
    assert body['unwatchedAiredEpisodeCount'] == 1
    assert body['libraryAnimeCount'] == 1
    assert body['totalWatchSeconds'] == 24 * 60
    assert body['averageWeeklyWatchedEpisodesLastQuarter'] == pytest.approx(0.15)
    assert body['weekStartDay'] == 0
    assert len(body['weekly']) == 13
    assert sum(item['watchedEpisodeCount'] for item in body['daily']) == 2


def test_statistics_summary_excludes_on_hold_from_unwatched_aired(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    active = add_library_anime(
        db_session,
        external_id='stats-active-backlog',
        original_name='Stats Active Backlog',
        names=[('Stats Active Backlog', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    on_hold = add_library_anime(
        db_session,
        external_id='stats-on-hold-backlog',
        original_name='Stats On Hold Backlog',
        names=[('Stats On Hold Backlog', 'en')],
        status=UserAnimeStatus.ON_HOLD,
    )
    add_episode(db_session, active, number=1)
    add_episode(db_session, on_hold, number=1)
    db_session.commit()

    response = client.get('/api/statistics/summary')

    assert response.status_code == 200
    body = response.get_json()
    assert body['unwatchedAiredEpisodeCount'] == 1


def test_statistics_summary_uses_week_start_day(client: FlaskClient, db_session: Session) -> None:
    assert register_user(client).status_code == 201
    assert client.patch('/api/user/me/preferences', json={'weekStartDay': 6}).status_code == 200
    anime = add_library_anime(
        db_session,
        external_id='week-start',
        original_name='Week Start',
        names=[('Week Start', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    sunday_episode = add_episode(db_session, anime, number=1, duration='00:24:00')
    monday_episode = add_episode(db_session, anime, number=2, duration='00:24:00')
    db_session.add_all(
        [
            UserEpisodeProgress(
                user_id=1,
                episode_id=sunday_episode.id,
                watched=True,
                watched_at=datetime(2026, 7, 5, 12, tzinfo=UTC),
            ),
            UserEpisodeProgress(
                user_id=1,
                episode_id=monday_episode.id,
                watched=True,
                watched_at=datetime(2026, 7, 6, 12, tzinfo=UTC),
            ),
        ],
    )
    db_session.commit()

    response = client.get('/api/statistics/summary')

    assert response.status_code == 200
    body = response.get_json()
    assert body['weekStartDay'] == 6
    week = next(item for item in body['weekly'] if item['weekStartDate'] == '2026-07-05')
    assert week['weekEndDate'] == '2026-07-11'
    assert week['watchedEpisodeCount'] == 2


def test_statistics_watch_timeline_paginates_and_excludes_dropped(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='timeline',
        original_name='Timeline Anime',
        names=[('Timeline Name', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    first = add_episode(db_session, anime, number=1, title='First', duration='00:24:00')
    second = add_episode(db_session, anime, number=2, title='Second', duration='00:25:00')
    dropped = add_library_anime(
        db_session,
        external_id='timeline-dropped',
        original_name='Timeline Dropped',
        names=[('Timeline Dropped', 'en')],
        status=UserAnimeStatus.DROPPED,
    )
    dropped_episode = add_episode(db_session, dropped, number=1, title='Dropped')
    db_session.add_all(
        [
            UserEpisodeProgress(
                user_id=1,
                episode_id=first.id,
                watched=True,
                watched_at=datetime(2026, 7, 10, 12, tzinfo=UTC),
            ),
            UserEpisodeProgress(
                user_id=1,
                episode_id=second.id,
                watched=True,
                watched_at=datetime(2026, 7, 11, 12, tzinfo=UTC),
            ),
            UserEpisodeProgress(
                user_id=1,
                episode_id=dropped_episode.id,
                watched=True,
                watched_at=datetime(2026, 7, 12, 12, tzinfo=UTC),
            ),
        ],
    )
    db_session.commit()

    response = client.get('/api/watch-state/watch-timeline?limit=1&offset=0')
    second_response = client.get('/api/watch-state/watch-timeline?limit=1&offset=1')

    assert response.status_code == 200
    body = response.get_json()
    assert body['total'] == 2
    assert body['hasMore'] is True
    assert body['items'][0]['anime']['displayName'] == 'Timeline Name'
    assert body['items'][0]['episode']['episodeNumber'] == 2
    assert body['items'][0]['episode']['durationSeconds'] == 25 * 60
    assert second_response.status_code == 200
    second_body = second_response.get_json()
    assert second_body['hasMore'] is False
    assert second_body['items'][0]['episode']['episodeNumber'] == 1


def test_statistics_recalculate_returns_ready_summary(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201

    response = client.post('/api/statistics/recalculate')

    assert response.status_code == 200
    assert response.get_json()['status'] == 'ready'


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
    assert body['posterUrl'] == f'/api/anime/{anime.id}/assets/poster?v=2-ready'
    assert [poster['url'] for poster in body['availablePosters']] == [
        f'/api/anime/{anime.id}/assets/posters/1?v=1-failed',
        f'/api/anime/{anime.id}/assets/posters/2?v=2-ready',
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
            'url': '/api/anime/1/assets/poster?v=1-pending',
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


def test_sync_library_anime_requires_login(client: FlaskClient) -> None:
    response = client.post('/api/anime/library/1/sync')

    assert response.status_code == 401
    assert response.get_json() == {'message': 'Authentication required'}


def test_sync_library_anime_requires_user_library_entry(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    provider = MutableDetailProvider({'1': anime_detail('1')})
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    assert register_user(client).status_code == 201
    anime = AnimeMetaInfo(provider_type='bangumi', external_id='1', original_name='Other')
    db_session.add(anime)
    db_session.commit()

    response = client.post(f'/api/anime/library/{anime.id}/sync')

    assert response.status_code == 404
    assert response.get_json() == {'message': 'Anime not found'}
    assert provider.detail_calls == []


def test_sync_library_anime_updates_existing_data_without_duplicate_and_preserves_progress(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='1',
        original_name='Old Anime',
        names=[('Old Name', 'en'), ('Remove Name', 'zh')],
    )
    old_episode = add_episode(db_session, anime, number=1, title='Old Episode')
    db_session.add(AnimeSummary(anime_id=anime.id, language='zh', summary='old summary'))
    db_session.add(EpisodeName(episode_id=old_episode.id, name='Old Episode', language='en'))
    db_session.add(UserEpisodeProgress(user_id=1, episode_id=old_episode.id, watched=True, watched_at=datetime.now(UTC)))
    db_session.commit()
    provider = MutableDetailProvider(
        {
            '1': anime_detail(
                '1',
                title='New Anime',
                summaries=[ImportAnimeSummary(language='zh', summary='new summary')],
                names=[ImportAnimeName(name='New Name', language='en')],
                episodes=[episode_info(1, title='New Episode'), episode_info(2, title='New Episode 2')],
            ),
        },
    )
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})

    response = client.post(f'/api/anime/library/{anime.id}/sync')

    assert response.status_code == 200
    body = response.get_json()
    assert body['synced'] is True
    assert body['episodeConflicts'] == []
    assert body['anime']['originalName'] == 'New Anime'
    assert provider.detail_calls == ['1']
    db_session.expire_all()
    updated_anime = db_session.get(AnimeMetaInfo, anime.id)
    assert updated_anime is not None
    assert updated_anime.original_name == 'New Anime'
    assert updated_anime.total_episodes == 2
    assert db_session.scalars(select(AnimeMetaInfo)).all() == [updated_anime]
    assert [summary.summary for summary in db_session.scalars(select(AnimeSummary)).all()] == ['new summary']
    assert sorted(name.name for name in db_session.scalars(select(AnimeName)).all()) == ['New Anime', 'New Name']
    episodes = db_session.scalars(select(Episode).order_by(Episode.episode_number)).all()
    assert [episode.original_title for episode in episodes] == ['New Episode', 'New Episode 2']
    assert db_session.scalar(select(UserEpisodeProgress).where(UserEpisodeProgress.episode_id == old_episode.id)) is not None


def test_sync_library_anime_deletes_unwatched_removed_episode_and_reports_watched_conflict(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(db_session, external_id='1', original_name='Old Anime', names=[('Old Anime', 'en')])
    kept = add_episode(db_session, anime, number=1, title='Kept')
    unwatched_removed = add_episode(db_session, anime, number=2, title='Unwatched Removed')
    watched_removed = add_episode(db_session, anime, number=3, title='Watched Removed')
    kept_id = kept.id
    unwatched_removed_id = unwatched_removed.id
    watched_removed_id = watched_removed.id
    db_session.add(UserEpisodeProgress(user_id=1, episode_id=watched_removed.id, watched=True, watched_at=datetime.now(UTC)))
    db_session.commit()
    provider = MutableDetailProvider({'1': anime_detail('1', episodes=[episode_info(1, title='Kept Updated')])})
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})

    response = client.post(f'/api/anime/library/{anime.id}/sync')

    assert response.status_code == 200
    conflicts = response.get_json()['episodeConflicts']
    assert len(conflicts) == 1
    assert conflicts[0]['episodeId'] == watched_removed_id
    assert conflicts[0]['watchedUserCount'] == 1
    db_session.expire_all()
    assert db_session.get(Episode, kept_id) is not None
    assert db_session.get(Episode, unwatched_removed_id) is None
    assert db_session.get(Episode, watched_removed_id) is not None
    assert db_session.scalar(select(UserEpisodeProgress).where(UserEpisodeProgress.episode_id == watched_removed_id)) is not None


def test_resolve_episode_conflicts_deletes_only_confirmed_conflict(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(db_session, external_id='1', original_name='Old Anime', names=[('Old Anime', 'en')])
    normal = add_episode(db_session, anime, number=1, title='Normal')
    conflict = add_episode(db_session, anime, number=2, title='Conflict')
    normal_id = normal.id
    conflict_id = conflict.id
    db_session.add(UserEpisodeProgress(user_id=1, episode_id=conflict.id, watched=True, watched_at=datetime.now(UTC)))
    db_session.commit()
    provider = MutableDetailProvider({'1': anime_detail('1', episodes=[episode_info(1, title='Normal')])})
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    assert client.post(f'/api/anime/library/{anime.id}/sync').status_code == 200

    response = client.post(
        f'/api/anime/library/{anime.id}/sync/episode-conflicts/resolve',
        json={'deleteEpisodeIds': [conflict_id, normal_id]},
    )

    assert response.status_code == 200
    resolution = response.get_json()['resolution']
    assert resolution['deletedEpisodeIds'] == [conflict_id]
    assert resolution['invalidEpisodeIds'] == [normal_id]
    db_session.expire_all()
    assert db_session.get(Episode, conflict_id) is None
    assert db_session.get(Episode, normal_id) is not None


def test_sync_library_anime_maps_provider_errors(app: Flask, client: FlaskClient, db_session: Session) -> None:
    class TimeoutProvider(FakeProvider):
        def get_anime_detail(self, _external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
            _ = language
            message = 'timeout'
            raise ImportProviderTimeoutError(message)

    class ResponseErrorProvider(FakeProvider):
        def get_anime_detail(self, _external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
            _ = language
            message = 'bad'
            raise ImportProviderResponseError(message)

    assert register_user(client).status_code == 201
    anime = add_library_anime(db_session, external_id='1', original_name='Old Anime', names=[('Old Anime', 'en')])
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': TimeoutProvider()})
    timeout_response = client.post(f'/api/anime/library/{anime.id}/sync')
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': ResponseErrorProvider()})
    response_error_response = client.post(f'/api/anime/library/{anime.id}/sync')

    assert timeout_response.status_code == 504
    assert timeout_response.get_json() == {'message': 'Import provider request timed out'}
    assert response_error_response.status_code == 502
    assert response_error_response.get_json() == {'message': 'Import provider response error'}


def test_sync_all_library_reuses_active_refresh_job(
    app: Flask,
    client: FlaskClient,
    test_instance_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import anime_info

    assert register_user(client).status_code == 201
    app.config['LIBRARY_REFRESH_JOB_LOCK_DIR'] = str(test_instance_path / 'library-refresh-locks')
    queued_task_ids: list[str] = []

    @dataclass(frozen=True)
    class Result:
        id: str

    def apply_async(*, args, task_id):  # type: ignore[no-untyped-def]
        assert args[0] == 1
        queued_task_ids.append(task_id)
        return Result(id=task_id)

    monkeypatch.setattr(anime_info.refresh_user_library, 'apply_async', apply_async)

    first = client.post('/api/anime/library/sync-all')
    second = client.post('/api/anime/library/sync-all')

    assert first.status_code == 202
    assert second.status_code == 202
    first_body = first.get_json()
    second_body = second.get_json()
    assert first_body['queued'] is True
    assert first_body['job']['jobId'] == first_body['taskId']
    assert first_body['job']['status'] == 'queued'
    assert first_body['job']['progress']['stage'] == 'queued'
    assert second_body['queued'] is False
    assert second_body['taskId'] == first_body['taskId']
    assert second_body['job']['jobId'] == first_body['taskId']
    assert queued_task_ids == [first_body['taskId']]

    current = client.get('/api/anime/library/sync-all')
    by_id = client.get(f"/api/anime/library/sync-all/{first_body['taskId']}")

    assert current.status_code == 200
    assert by_id.status_code == 200
    assert current.get_json()['job']['jobId'] == first_body['taskId']
    assert by_id.get_json()['jobId'] == first_body['taskId']


def test_sync_airing_anime_task_selects_airing_and_continues_after_failure(
    app: Flask,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.tasks import anime_sync as anime_sync_task

    now = datetime.now(UTC)
    upcoming = add_library_anime(db_session, external_id='upcoming', original_name='Upcoming', names=[('Upcoming', 'en')])
    add_episode(db_session, upcoming, number=1, status=EpisodeStatus.UPCOMING, air_at=now + timedelta(days=1))
    unknown_total = add_library_anime(db_session, external_id='unknown', original_name='Unknown', names=[('Unknown', 'en')])
    unknown_total.total_episodes = None
    partial = add_library_anime(db_session, external_id='partial', original_name='Partial', names=[('Partial', 'en')])
    partial.total_episodes = 2
    add_episode(db_session, partial, number=1, status=EpisodeStatus.AIRED, air_at=now - timedelta(days=1))
    finished = add_library_anime(db_session, external_id='finished', original_name='Finished', names=[('Finished', 'en')])
    finished.total_episodes = 1
    add_episode(db_session, finished, number=1, status=EpisodeStatus.AIRED, air_at=now - timedelta(days=1))
    db_session.commit()
    provider = MutableDetailProvider(
        {
            'upcoming': anime_detail('upcoming', episodes=[episode_info(1)]),
            'partial': anime_detail('partial', episodes=[episode_info(1), episode_info(2)]),
        },
    )

    class Factory:
        @classmethod
        def from_config(cls, _config):  # type: ignore[no-untyped-def]
            return ImportProviderFactory({'bangumi': provider})

    monkeypatch.setattr(anime_sync_task, 'ImportProviderFactory', Factory)
    monkeypatch.setattr(anime_sync_task, '_enqueue_poster_download', lambda *_args: None)
    celery_app.conf.database_url = app.config['DATABASE_URL']

    summary = anime_sync_task.sync_airing_anime()

    assert summary['checked'] == 3
    assert summary['synced'] == 2
    assert summary['failed'] == 1
    assert provider.detail_calls == ['upcoming', 'unknown', 'partial']


def test_celery_beat_schedule_defaults_and_env_override() -> None:
    configure_celery(
        {
            'CELERY_BROKER_URL': 'memory://',
            'ANIME_SYNC_CRON_HOUR': 4,
            'ANIME_SYNC_CRON_MINUTE': 0,
            'UNTRACKED_ANIME_CLEANUP_CRON_DAY': 7,
            'UNTRACKED_ANIME_CLEANUP_CRON_HOUR': 8,
            'UNTRACKED_ANIME_CLEANUP_CRON_MINUTE': 9,
        },
    )
    default_schedule = celery_app.conf.beat_schedule['sync-airing-anime']['schedule']
    cleanup_schedule = celery_app.conf.beat_schedule['delete-untracked-anime']['schedule']
    assert 'discover-tvdb-seasons' not in celery_app.conf.beat_schedule
    configure_celery(
        {
            'CELERY_BROKER_URL': 'memory://',
            'ANIME_SYNC_CRON_HOUR': 6,
            'ANIME_SYNC_CRON_MINUTE': 30,
            'AUTO_IMPORT_TVDB_SEASONS_ENABLED': True,
            'AUTO_IMPORT_TVDB_SEASONS_CRON_DAY': 11,
            'AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR': 12,
            'AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE': 13,
        },
    )
    override_schedule = celery_app.conf.beat_schedule['sync-airing-anime']['schedule']
    tvdb_season_schedule = celery_app.conf.beat_schedule['discover-tvdb-seasons']['schedule']

    assert default_schedule.hour == {4}
    assert default_schedule.minute == {0}
    assert cleanup_schedule.month_of_year == {2, 5, 8, 11}
    assert cleanup_schedule.day_of_month == {7}
    assert cleanup_schedule.hour == {8}
    assert cleanup_schedule.minute == {9}
    assert override_schedule.hour == {6}
    assert override_schedule.minute == {30}
    assert tvdb_season_schedule.day_of_month == {11}
    assert tvdb_season_schedule.hour == {12}
    assert tvdb_season_schedule.minute == {13}


def test_celery_beat_schedule_adds_bangumi_related_anime_discovery() -> None:
    configure_celery(
        {
            'CELERY_BROKER_URL': 'memory://',
            'AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED': True,
            'AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY': 14,
            'AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR': 15,
            'AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE': 16,
        },
    )

    schedule = celery_app.conf.beat_schedule['discover-bangumi-related-anime']['schedule']

    assert schedule.day_of_month == {14}
    assert schedule.hour == {15}
    assert schedule.minute == {16}


def test_auto_import_default_cron_runs_randomized_overnight() -> None:
    configure_celery(
        {
            'CELERY_BROKER_URL': 'memory://',
            'AUTO_IMPORT_TVDB_SEASONS_ENABLED': True,
            'AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED': True,
        },
    )

    tvdb_schedule = celery_app.conf.beat_schedule['discover-tvdb-seasons']['schedule']
    bangumi_schedule = celery_app.conf.beat_schedule['discover-bangumi-related-anime']['schedule']

    assert tvdb_schedule.day_of_month <= set(range(1, 29))
    assert tvdb_schedule.hour <= {1, 2, 3}
    assert tvdb_schedule.minute <= set(range(60))
    assert bangumi_schedule.day_of_month <= set(range(1, 29))
    assert bangumi_schedule.hour <= {3, 4, 5}
    assert bangumi_schedule.minute <= set(range(60))


def test_bangumi_related_anime_discovery_imports_plan_to_watch(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.related_anime_discovery import discover_related_anime_for_user_anime

    current = add_library_anime(db_session, external_id='current', original_name='Current', names=[('Current', 'en')])
    related_item = ImportRelatedAnime(
        provider='bangumi',
        external_id='related',
        title='Related',
        relation_type='same_series_season',
        season_number=None,
        air_date=None,
        episode_count=None,
        url='https://bgm.tv/subject/related',
        poster_source_url='https://example.test/related.jpg',
        raw_data={'id': 'related'},
    )
    provider = MutableDetailProvider(
        {
            'current': replace(anime_detail('current', title='Current'), related_anime=[related_item]),
            'related': anime_detail('related', title='Related'),
        },
    )
    monkeypatch.setattr('app.services.related_anime_discovery.enqueue_poster_download', lambda _poster_id: None)

    result = discover_related_anime_for_user_anime(db_session, provider, user_id=1, anime_id=current.id, provider_name='bangumi')

    related = db_session.scalar(select(AnimeMetaInfo).where(AnimeMetaInfo.provider_type == 'bangumi', AnimeMetaInfo.external_id == 'related'))
    assert result.checked is True
    assert result.skipped_reason is None
    assert related is not None
    assert result.imported_anime_ids == [related.id]
    progress = db_session.scalar(select(UserAnimeProgress).where(UserAnimeProgress.user_id == 1, UserAnimeProgress.anime_id == related.id))
    assert progress is not None
    assert progress.status == UserAnimeStatus.PLAN_TO_WATCH


def test_bangumi_related_anime_discovery_endpoint_imports_plan_to_watch(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert register_user(client).status_code == 201
    app.config['AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED'] = True
    current = add_library_anime(db_session, external_id='current', original_name='Current', names=[('Current', 'en')])
    related_item = ImportRelatedAnime(
        provider='bangumi',
        external_id='related',
        title='Related',
        relation_type='same_series_season',
        season_number=None,
        air_date=None,
        episode_count=None,
        url='https://bgm.tv/subject/related',
        poster_source_url=None,
        raw_data={'id': 'related'},
    )
    provider = MutableDetailProvider(
        {
            'current': replace(anime_detail('current', title='Current'), related_anime=[related_item]),
            'related': anime_detail('related', title='Related'),
        },
    )

    class Factory:
        @classmethod
        def from_config(cls, _config):  # type: ignore[no-untyped-def]
            return ImportProviderFactory({'bangumi': provider})

    monkeypatch.setattr('app.tasks.related_anime_discovery.ImportProviderFactory', Factory)
    monkeypatch.setattr('app.services.related_anime_discovery.enqueue_poster_download', lambda _poster_id: None)
    celery_app.conf.task_always_eager = True
    celery_app.conf.database_url = app.config['DATABASE_URL']

    response = client.post(f'/api/anime/library/{current.id}/discover-related-anime')

    assert response.status_code == 202
    payload = response.get_json()
    job_response = client.get(f'/api/anime/library/{current.id}/discover-related-anime/{payload["taskId"]}')
    assert job_response.status_code == 200
    job = job_response.get_json()
    assert job['status'] == 'completed'
    assert job['summary']['skippedReason'] is None
    related = db_session.scalar(select(AnimeMetaInfo).where(AnimeMetaInfo.provider_type == 'bangumi', AnimeMetaInfo.external_id == 'related'))
    assert related is not None
    assert job['summary']['importedAnimeIds'] == [related.id]


def test_celery_beat_schedule_ignores_invalid_cleanup_months() -> None:
    configure_celery(
        {
            'CELERY_BROKER_URL': 'memory://',
            'UNTRACKED_ANIME_CLEANUP_CRON_MONTHS': 'not-a-month',
            'UNTRACKED_ANIME_CLEANUP_CRON_DAY': 7,
            'UNTRACKED_ANIME_CLEANUP_CRON_HOUR': 8,
            'UNTRACKED_ANIME_CLEANUP_CRON_MINUTE': 9,
        },
    )

    cleanup_schedule = celery_app.conf.beat_schedule['delete-untracked-anime']['schedule']

    assert cleanup_schedule.month_of_year == {2, 5, 8, 11}


def test_scheduled_tasks_retry_three_times_after_five_minutes() -> None:
    from app.tasks.anime_cleanup import delete_untracked_anime_task
    from app.tasks.anime_sync import sync_airing_anime
    from app.tasks.bangumi_related_anime_discovery import (
        discover_bangumi_related_anime_for_all_users,
    )
    from app.tasks.tvdb_season_discovery import discover_tvdb_seasons_for_all_users

    for task in (delete_untracked_anime_task, sync_airing_anime, discover_bangumi_related_anime_for_all_users, discover_tvdb_seasons_for_all_users):
        assert task.autoretry_for == (Exception,)
        assert task.retry_kwargs == {'countdown': 5 * 60, 'max_retries': 3}
        assert task.max_retries == 3


def test_delete_untracked_anime_task_removes_database_rows_and_posters(
    app: Flask,
    db_session: Session,
) -> None:
    from app.tasks.anime_cleanup import delete_untracked_anime_task

    tracked = add_library_anime(db_session, external_id='tracked', original_name='Tracked', names=[('Tracked', 'en')])
    untracked = AnimeMetaInfo(provider_type='bangumi', external_id='orphan', original_name='Orphan')
    db_session.add(untracked)
    db_session.flush()
    untracked_name = AnimeName(anime_id=untracked.id, name='Orphan', language='en')
    untracked_summary = AnimeSummary(anime_id=untracked.id, language='en', summary='summary')
    untracked_episode = Episode(anime_id=untracked.id, episode_number=1, original_title='Episode 1')
    untracked_poster = AnimePoster(anime_id=untracked.id, storage_path='orphan.jpg', status='ready')
    db_session.add_all([untracked_name, untracked_summary, untracked_episode, untracked_poster])
    db_session.flush()
    untracked_episode_name = EpisodeName(episode_id=untracked_episode.id, name='Episode 1', language='en')
    db_session.add(untracked_episode_name)
    poster_dir = Path(app.config['ANIME_POSTER_STORAGE_DIR'])
    poster_dir.mkdir(parents=True)
    poster_path = poster_dir / 'orphan.jpg'
    poster_path.write_bytes(b'poster')
    db_session.commit()
    tracked_id = tracked.id
    untracked_id = untracked.id
    untracked_name_id = untracked_name.id
    untracked_summary_id = untracked_summary.id
    untracked_episode_id = untracked_episode.id
    untracked_episode_name_id = untracked_episode_name.id
    untracked_poster_id = untracked_poster.id
    celery_app.conf.database_url = app.config['DATABASE_URL']
    celery_app.conf.anime_poster_storage_dir = app.config['ANIME_POSTER_STORAGE_DIR']

    summary = delete_untracked_anime_task()

    db_session.expire_all()
    assert summary == {'deletedAnime': 1, 'deletedPosters': 1}
    assert db_session.get(AnimeMetaInfo, tracked_id) is not None
    assert db_session.get(AnimeMetaInfo, untracked_id) is None
    assert db_session.get(AnimeName, untracked_name_id) is None
    assert db_session.get(AnimeSummary, untracked_summary_id) is None
    assert db_session.get(Episode, untracked_episode_id) is None
    assert db_session.get(EpisodeName, untracked_episode_name_id) is None
    assert db_session.get(AnimePoster, untracked_poster_id) is None
    assert not poster_path.exists()


def test_delete_untracked_anime_task_keeps_poster_referenced_by_relation(
    app: Flask,
    db_session: Session,
) -> None:
    from app.tasks.anime_cleanup import delete_untracked_anime_task

    tracked = add_library_anime(db_session, external_id='tracked', original_name='Tracked', names=[('Tracked', 'en')])
    untracked = AnimeMetaInfo(provider_type='bangumi', external_id='related', original_name='Related')
    db_session.add(untracked)
    db_session.flush()
    poster = AnimePoster(anime_id=untracked.id, storage_path='related.jpg', status='ready')
    db_session.add(poster)
    db_session.flush()
    relation = AnimeRelation(
        anime_id=tracked.id,
        related_anime_id=untracked.id,
        poster_id=poster.id,
        provider_type='bangumi',
        external_id='related',
        relation_type='same_series_season',
        title='Related',
    )
    db_session.add(relation)
    poster_dir = Path(app.config['ANIME_POSTER_STORAGE_DIR'])
    poster_dir.mkdir(parents=True)
    poster_path = poster_dir / 'related.jpg'
    poster_path.write_bytes(b'poster')
    db_session.commit()
    untracked_id = untracked.id
    poster_id = poster.id
    celery_app.conf.database_url = app.config['DATABASE_URL']
    celery_app.conf.anime_poster_storage_dir = app.config['ANIME_POSTER_STORAGE_DIR']

    summary = delete_untracked_anime_task()

    db_session.expire_all()
    assert summary == {'deletedAnime': 0, 'deletedPosters': 0}
    assert db_session.get(AnimeMetaInfo, untracked_id) is not None
    assert db_session.get(AnimePoster, poster_id) is not None
    assert poster_path.exists()


def test_create_app_preserves_celery_task_always_eager_env(test_instance_path, monkeypatch: pytest.MonkeyPatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv('CELERY_TASK_ALWAYS_EAGER', '1')

    create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'eager.db'}",
            'SECRET_KEY': 'test-secret',
            'TESTING': True,
        },
    )

    assert celery_app.conf.task_always_eager is True
