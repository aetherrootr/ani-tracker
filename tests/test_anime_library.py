from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import event, select
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
    UserAnimeMetadataEpisodeSnapshot,
    UserAnimeMetadataSnapshot,
    UserAnimeProgress,
    UserAnimeRelationDeletionPrompt,
    UserAnimeRelationOverride,
    UserAnimeStatus,
    UserEpisodeProgress,
    UserManualAnimeRelation,
)
from app.models.user import User
from app.services.anime_library import _resolved_episode_status
from app.services.anime_statistics import get_statistics_summary, get_watch_timeline
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
    air_at_has_time: bool = False,
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
        air_at_has_time=air_at_has_time,
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


def test_episode_air_time_precision_preserves_exact_midnight(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    provider = MutableDetailProvider(
        {
            'midnight': anime_detail(
                'midnight',
                episodes=[
                    episode_info(1, air_at=datetime(2024, 4, 1, tzinfo=UTC)),
                    episode_info(2, air_at=datetime(2024, 4, 2, tzinfo=UTC), air_at_has_time=True),
                ],
            ),
        },
    )
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    assert register_user(client).status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': 'midnight'}).status_code == 201
    anime_id = db_session.scalar(select(AnimeMetaInfo.id))
    assert anime_id is not None

    body = client.get(f'/api/anime/library/{anime_id}/episodes').get_json()

    assert [episode['airAt'][:19] for episode in body['episodes']] == ['2024-04-01T00:00:00', '2024-04-02T00:00:00']
    assert [episode['airAtPrecision'] for episode in body['episodes']] == ['date', 'datetime']


def test_date_only_episode_uses_configured_local_date_for_status(app: Flask) -> None:
    app.config['ANIME_SYNC_TIMEZONE'] = 'Asia/Shanghai'
    air_at = datetime(2026, 7, 21, tzinfo=UTC)
    now = datetime(2026, 7, 20, 18, 42, tzinfo=UTC)

    with app.app_context():
        date_only_status = _resolved_episode_status('upcoming', air_at, air_at_has_time=False, now=now)
        exact_time_status = _resolved_episode_status('upcoming', air_at, air_at_has_time=True, now=now)

    assert date_only_status == EpisodeStatus.AIRED
    assert exact_time_status == EpisodeStatus.UPCOMING


def test_tvdb_date_only_episode_uses_source_air_time_for_status(app: Flask) -> None:
    app.config['ANIME_SYNC_TIMEZONE'] = 'Asia/Shanghai'
    air_at = datetime(2026, 7, 21, tzinfo=UTC)
    source_air_at = datetime(2026, 7, 21, 14, 30, tzinfo=UTC)

    with app.app_context():
        before_air_time = _resolved_episode_status(
            'upcoming',
            air_at,
            air_at_has_time=False,
            status_air_at=source_air_at,
            now=datetime(2026, 7, 21, 2, 42, tzinfo=UTC),
        )
        after_air_time = _resolved_episode_status(
            'upcoming',
            air_at,
            air_at_has_time=False,
            status_air_at=source_air_at,
            now=datetime(2026, 7, 21, 15, tzinfo=UTC),
        )

    assert before_air_time == EpisodeStatus.UPCOMING
    assert after_air_time == EpisodeStatus.AIRED


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
    db_session.flush()
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


def test_related_anime_uses_library_display_name(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current Anime')
    related = AnimeMetaInfo(
        provider_type='bangumi',
        external_id='related',
        original_name='Related Original',
        air_date=date(2026, 7, 5),
        total_episodes=12,
    )
    db_session.add_all([current, related])
    db_session.flush()
    preferred_name = AnimeName(anime_id=related.id, language='zh', name='用户选择的相关动画名')
    db_session.add(preferred_name)
    db_session.flush()
    db_session.add(
        AnimeRelation(
            anime_id=current.id,
            provider_type='bangumi',
            external_id='related',
            relation_type='same_series_season',
            title='Provider Related Title',
            related_anime_id=related.id,
        ),
    )
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(
        UserAnimeProgress(
            user_id=1,
            anime_id=related.id,
            status=UserAnimeStatus.PLAN_TO_WATCH,
            preferred_name_id=preferred_name.id,
        ),
    )
    db_session.commit()

    response = client.get(f'/api/anime/{current.id}')

    assert response.status_code == 200
    related_item = response.get_json()['anime']['relatedAnime'][0]
    assert related_item['title'] == '用户选择的相关动画名'
    assert related_item['inLibrary'] is True
    assert related_item['airDate'] == '2026-07-05'
    assert related_item['episodeCount'] == 12


def test_provider_switch_without_target_related_falls_back_to_old_provider_relation(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current Anime')
    old_related = AnimeMetaInfo(provider_type='bangumi', external_id='old-related', original_name='Old Related')
    old_related_next = AnimeMetaInfo(provider_type='bangumi', external_id='old-related-next', original_name='Old Related Next')
    db_session.add_all([current, old_related, old_related_next])
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='bangumi',
        external_id='old-related',
        relation_type='same_series_season',
        title='Old Provider Related',
        related_anime_id=old_related.id,
    )
    outgoing_relation = AnimeRelation(
        anime_id=old_related.id,
        provider_type='bangumi',
        external_id='old-related-next',
        relation_type='same_series_season',
        title='Old Provider Next Season',
        related_anime_id=old_related_next.id,
    )
    db_session.add_all([relation, outgoing_relation])
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=old_related.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=old_related_next.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()
    provider = NamedMutableDetailProvider('tvdb', {'new-related': replace(anime_detail('new-related', title='Target TVDB'), provider='tvdb', related_anime=[])})
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': FakeProvider(), 'tvdb': provider})

    switch_response = client.post(
        f'/api/anime/library/{old_related.id}/provider-switch',
        json={'provider': 'tvdb', 'externalId': 'new-related'},
    )

    assert switch_response.status_code == 200
    payload = switch_response.get_json()
    assert 'relatedAnimeMode' not in payload
    target_id = payload['anime']['id']
    detail_response = client.get(f'/api/anime/{target_id}')
    related = detail_response.get_json()['anime']['relatedAnime'][0]
    assert related['source'] == 'provider'
    assert related['provider'] == 'bangumi'
    assert related['animeId'] == old_related_next.id


def test_related_anime_override_endpoint_updates_user_mapping(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='tvdb', external_id='current', original_name='Current Anime')
    target = AnimeMetaInfo(provider_type='bangumi', external_id='target', original_name='Target Anime')
    db_session.add_all([current, target])
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='tvdb',
        external_id='target-tvdb',
        relation_type='same_series_season',
        title='Needs Mapping',
    )
    db_session.add(relation)
    db_session.flush()
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=target.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()

    response = client.patch(
        f'/api/anime/library/{current.id}/related-anime/{relation.id}/override',
        json={'relatedAnimeId': target.id},
    )

    assert response.status_code == 200
    override = db_session.scalar(select(UserAnimeRelationOverride).where(UserAnimeRelationOverride.anime_relation_id == relation.id))
    assert override is not None
    assert override.related_anime_id == target.id
    detail_response = client.get(f'/api/anime/{current.id}')
    related = detail_response.get_json()['anime']['relatedAnime'][0]
    assert related['animeId'] == target.id
    assert related['mappedByOverride'] is True


def test_related_anime_override_is_visible_from_mapped_target_side(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='tvdb', external_id='current', original_name='Current Anime')
    target = AnimeMetaInfo(provider_type='bangumi', external_id='target', original_name='Target Anime')
    db_session.add_all([current, target])
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='tvdb',
        external_id='target-tvdb',
        relation_type='same_series_season',
        title='Needs Mapping',
    )
    db_session.add(relation)
    db_session.flush()
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=target.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeRelationOverride(user_id=1, anime_relation_id=relation.id, related_anime_id=target.id))
    db_session.commit()

    response = client.get(f'/api/anime/{target.id}')

    assert response.status_code == 200
    related = response.get_json()['anime']['relatedAnime'][0]
    assert related['animeId'] == current.id
    assert related['title'] == 'Current Anime'
    assert related['mappedByOverride'] is True
    assert related['relationId'] == relation.id

    clear_response = client.patch(
        f'/api/anime/library/{target.id}/related-anime/{relation.id}/override',
        json={'relatedAnimeId': None},
    )
    assert clear_response.status_code == 200
    assert db_session.scalar(select(UserAnimeRelationOverride).where(UserAnimeRelationOverride.anime_relation_id == relation.id)) is None


def test_manual_related_anime_displays_from_both_sides(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    first = AnimeMetaInfo(provider_type='bangumi', external_id='first', original_name='First')
    second = AnimeMetaInfo(provider_type='bangumi', external_id='second', original_name='Second')
    db_session.add_all([first, second])
    db_session.flush()
    db_session.add(UserAnimeProgress(user_id=1, anime_id=first.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=second.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()

    create_response = client.post(
        f'/api/anime/library/{first.id}/manual-related-anime',
        json={'relatedAnimeId': second.id, 'relationType': 'same_series_manual', 'note': 'manual'},
    )

    assert create_response.status_code == 201
    manual_relation_id = create_response.get_json()['manualRelation']['id']
    first_related = client.get(f'/api/anime/{first.id}').get_json()['anime']['relatedAnime'][0]
    second_related = client.get(f'/api/anime/{second.id}').get_json()['anime']['relatedAnime'][0]
    assert first_related['source'] == 'manual'
    assert first_related['animeId'] == second.id
    assert second_related['source'] == 'manual'
    assert second_related['animeId'] == first.id
    assert db_session.get(UserManualAnimeRelation, manual_relation_id) is not None


def test_dropping_anime_deletes_user_related_anime_state(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current')
    related = AnimeMetaInfo(provider_type='bangumi', external_id='related', original_name='Related')
    mapped = AnimeMetaInfo(provider_type='tvdb', external_id='mapped', original_name='Mapped')
    db_session.add_all([current, related, mapped])
    db_session.flush()
    source_relation = AnimeRelation(
        anime_id=current.id,
        provider_type='bangumi',
        external_id='related',
        relation_type='same_series_season',
        title='Related',
        related_anime_id=related.id,
    )
    incoming_relation = AnimeRelation(
        anime_id=related.id,
        provider_type='bangumi',
        external_id='current',
        relation_type='same_series_season',
        title='Current',
        related_anime_id=current.id,
    )
    db_session.add_all([source_relation, incoming_relation])
    db_session.flush()
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=related.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=mapped.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeRelationOverride(user_id=1, anime_relation_id=source_relation.id, related_anime_id=mapped.id))
    db_session.add(UserAnimeRelationOverride(user_id=1, anime_relation_id=incoming_relation.id, related_anime_id=current.id))
    low_id, high_id = sorted((current.id, related.id))
    db_session.add(UserManualAnimeRelation(user_id=1, anime_id_low=low_id, anime_id_high=high_id))
    db_session.add(
        UserAnimeRelationDeletionPrompt(
            user_id=1,
            anime_id=current.id,
            related_anime_id=related.id,
            anime_relation_id=source_relation.id,
            provider='bangumi',
            external_id='related',
            title='Related',
            relation_type='same_series_season',
        ),
    )
    db_session.commit()

    response = client.patch(f'/api/anime/library/{current.id}/status', json={'status': 'dropped'})

    assert response.status_code == 200
    assert db_session.scalar(select(UserAnimeRelationOverride)) is None
    assert db_session.scalar(select(UserManualAnimeRelation)) is None
    assert db_session.scalar(select(UserAnimeRelationDeletionPrompt)) is None
    assert db_session.get(AnimeRelation, source_relation.id) is not None
    assert db_session.get(AnimeRelation, incoming_relation.id) is not None


def test_sync_removed_related_anime_creates_prompt_and_keep_creates_manual_relation(
    client: FlaskClient,
    db_session: Session,
) -> None:
    from app.services.anime_sync import sync_anime_from_provider

    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current Anime')
    related = AnimeMetaInfo(provider_type='bangumi', external_id='related', original_name='Related Anime')
    db_session.add_all([current, related])
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='bangumi',
        external_id='related',
        relation_type='same_series_season',
        title='Removed Related',
        related_anime_id=related.id,
    )
    db_session.add(relation)
    db_session.flush()
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=related.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()
    provider = MutableDetailProvider({'current': replace(anime_detail('current', title='Current Anime'), related_anime=[])})

    sync_anime_from_provider(db_session, provider, anime_id=current.id, user_id=1)
    db_session.commit()

    db_session.refresh(relation)
    assert relation.is_active is False
    prompt = db_session.scalar(select(UserAnimeRelationDeletionPrompt).where(UserAnimeRelationDeletionPrompt.anime_relation_id == relation.id))
    assert prompt is not None
    detail_related = client.get(f'/api/anime/{current.id}').get_json()['anime']['relatedAnime'][0]
    assert detail_related['pendingUpstreamDeletion'] is True
    keep_response = client.post(f'/api/anime/library/{current.id}/related-anime/deletion-prompts/{prompt.id}/keep')
    assert keep_response.status_code == 200
    manual = db_session.scalar(select(UserManualAnimeRelation).where(UserManualAnimeRelation.created_from_anime_relation_id == relation.id))
    assert manual is not None
    kept_related = client.get(f'/api/anime/{current.id}').get_json()['anime']['relatedAnime'][0]
    assert kept_related['source'] == 'manual'


def test_dismiss_deleted_related_anime_prompt_is_idempotent_and_visible_from_related_side(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current Anime')
    related = AnimeMetaInfo(provider_type='bangumi', external_id='related', original_name='Related Anime')
    db_session.add_all([current, related])
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='bangumi',
        external_id='related',
        relation_type='same_series_season',
        title='Removed Related',
        related_anime_id=related.id,
        is_active=False,
    )
    db_session.add(relation)
    db_session.flush()
    prompt = UserAnimeRelationDeletionPrompt(
        user_id=1,
        anime_id=current.id,
        related_anime_id=related.id,
        anime_relation_id=relation.id,
        provider='bangumi',
        external_id='related',
        title='Removed Related',
        relation_type='same_series_season',
    )
    db_session.add(prompt)
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=related.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()

    response = client.delete(f'/api/anime/library/{related.id}/related-anime/deletion-prompts/{prompt.id}')
    assert response.status_code == 204


def test_deleted_related_anime_prompt_is_serialized_from_related_side(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current Anime')
    related = AnimeMetaInfo(provider_type='bangumi', external_id='related', original_name='Related Anime')
    db_session.add_all([current, related])
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='bangumi',
        external_id='related',
        relation_type='same_series_season',
        title='Removed Related',
        related_anime_id=related.id,
        is_active=False,
    )
    db_session.add(relation)
    db_session.flush()
    prompt = UserAnimeRelationDeletionPrompt(
        user_id=1,
        anime_id=current.id,
        related_anime_id=related.id,
        anime_relation_id=relation.id,
        provider='bangumi',
        external_id='related',
        title='Removed Related',
        relation_type='same_series_season',
    )
    db_session.add(prompt)
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=related.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()

    response = client.get(f'/api/anime/{related.id}')

    assert response.status_code == 200
    item = response.get_json()['anime']['relatedAnime'][0]
    assert item['animeId'] == current.id
    assert item['title'] == 'Current Anime'
    assert item['pendingUpstreamDeletion'] is True
    assert item['deletionPromptId'] == prompt.id


def test_keep_deleted_related_anime_prompt_from_related_side_creates_manual_relation(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current Anime')
    related = AnimeMetaInfo(provider_type='bangumi', external_id='related', original_name='Related Anime')
    db_session.add_all([current, related])
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='bangumi',
        external_id='related',
        relation_type='same_series_season',
        title='Removed Related',
        related_anime_id=related.id,
        is_active=False,
    )
    db_session.add(relation)
    db_session.flush()
    prompt = UserAnimeRelationDeletionPrompt(
        user_id=1,
        anime_id=current.id,
        related_anime_id=related.id,
        anime_relation_id=relation.id,
        provider='bangumi',
        external_id='related',
        title='Removed Related',
        relation_type='same_series_season',
    )
    db_session.add(prompt)
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=related.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.commit()

    response = client.post(f'/api/anime/library/{related.id}/related-anime/deletion-prompts/{prompt.id}/keep')

    assert response.status_code == 200
    db_session.refresh(prompt)
    assert prompt.status == 'kept'
    low_id, high_id = sorted((current.id, related.id))
    manual = db_session.scalar(
        select(UserManualAnimeRelation).where(
            UserManualAnimeRelation.user_id == 1,
            UserManualAnimeRelation.anime_id_low == low_id,
            UserManualAnimeRelation.anime_id_high == high_id,
        ),
    )
    assert manual is not None


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
    assert episode.air_at_has_time is False
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
    assert episodes[1]['name'] is None
    assert episodes[1]['displayName'] == '別に魔法じゃなくたって...'


def test_episode_list_title_uses_language_fallbacks_before_original(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client, language_preference='zh-CN').status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='episode-title-fallback',
        original_name='Episode Secondary Title',
        names=[('Episode Secondary Title', 'eng')],
    )
    first = add_episode(db_session, anime, number=1, title='Imported original')
    second = add_episode(db_session, anime, number=2, title='Another imported original')
    first_english = EpisodeName(episode_id=first.id, name='English One', language='eng')
    first_japanese = EpisodeName(episode_id=first.id, name='日本語一', language='jpn')
    first_chinese = EpisodeName(episode_id=first.id, name='中文一', language='zho')
    second_japanese = EpisodeName(episode_id=second.id, name='日本語二', language='jpn')
    second_english = EpisodeName(episode_id=second.id, name='English Two', language='eng')
    db_session.add_all([first_english, first_japanese, first_chinese, second_japanese, second_english])
    db_session.flush()
    db_session.add_all([
        UserEpisodeProgress(user_id=1, episode_id=first.id, preferred_name_id=first_japanese.id),
        UserEpisodeProgress(user_id=1, episode_id=second.id, preferred_name_id=second_japanese.id),
    ])
    db_session.commit()

    response = client.get(f'/api/anime/library/{anime.id}/episodes')

    assert response.status_code == 200
    episodes = response.get_json()['episodes']
    assert episodes[0]['displayName'] == '日本語一'
    assert episodes[0]['originalTitle'] == 'Imported original'
    assert episodes[1]['displayName'] == '日本語二'
    assert episodes[1]['originalTitle'] == 'Another imported original'

    db_session.query(UserEpisodeProgress).delete()
    db_session.commit()
    episodes = client.get(f'/api/anime/library/{anime.id}/episodes').get_json()['episodes']
    assert episodes[0]['displayName'] == '中文一'
    assert episodes[1]['displayName'] == 'English Two'


def test_episode_list_filters_orders_and_locates_noncontiguous_episodes(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client, language_preference='en').status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='episode-navigation',
        original_name='Episode Navigation',
        names=[('Episode Navigation', 'en')],
    )
    episodes = [
        add_episode(db_session, anime, number=41, title='First Arc'),
        add_episode(db_session, anime, number=42, title='Second Arc'),
        add_episode(db_session, anime, number=50, title='Final Arc'),
        add_episode(db_session, anime, number=60, title='Special Arc'),
    ]
    db_session.add(EpisodeName(episode_id=episodes[2].id, name='Alternate Finale', language='en'))
    db_session.commit()
    assert client.patch(f'/api/watch-state/anime/{anime.id}/episodes/{episodes[1].id}', json={'watched': True}).status_code == 200

    descending = client.get(
        f'/api/anime/library/{anime.id}/episodes',
        query_string={'limit': 2, 'order': 'desc'},
    ).get_json()
    assert descending['total'] == 4
    assert descending['order'] == 'desc'
    assert [episode['episodeNumber'] for episode in descending['episodes']] == [60, 50]

    watched = client.get(
        f'/api/anime/library/{anime.id}/episodes',
        query_string={'filter': 'watched'},
    ).get_json()
    assert watched['total'] == 1
    assert [episode['episodeNumber'] for episode in watched['episodes']] == [42]

    number_search = client.get(
        f'/api/anime/library/{anime.id}/episodes',
        query_string={'q': 'e:4'},
    ).get_json()
    assert [episode['episodeNumber'] for episode in number_search['episodes']] == [41, 42]

    name_search = client.get(
        f'/api/anime/library/{anime.id}/episodes',
        query_string={'q': 'alternate finale'},
    ).get_json()
    assert [episode['episodeNumber'] for episode in name_search['episodes']] == [50]

    located = client.get(
        f'/api/anime/library/{anime.id}/episodes',
        query_string={'limit': 2, 'locateEpisodeNumber': 50},
    ).get_json()
    assert located['page'] == 2
    assert located['offset'] == 2
    assert located['location'] == {
        'id': episodes[2].id,
        'episodeNumber': 50,
        'index': 2,
        'offset': 2,
        'page': 2,
    }
    assert [episode['episodeNumber'] for episode in located['episodes']] == [50, 60]


@pytest.mark.parametrize(
    ('query', 'message'),
    [
        ({'filter': 'missing'}, 'Episode filter is invalid'),
        ({'order': 'sideways'}, 'Episode order is invalid'),
        ({'locateEpisodeNumber': '0'}, 'Episode number is invalid'),
        ({'locateEpisodeId': 'bad'}, 'Episode ID is invalid'),
    ],
)
def test_episode_list_rejects_invalid_query_state(
    client: FlaskClient,
    db_session: Session,
    query: dict[str, str],
    message: str,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='invalid-episode-query',
        original_name='Invalid Episode Query',
        names=[('Invalid Episode Query', 'en')],
    )

    response = client.get(f'/api/anime/library/{anime.id}/episodes', query_string=query)

    assert response.status_code == 400
    assert response.get_json() == {'message': message}


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


def test_library_list_filters_unwatched_episodes_and_air_status(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)
    not_started = add_library_anime(
        db_session,
        external_id='not-started-filter',
        original_name='Not Started Filter',
        names=[('Not Started Filter', 'en')],
    )
    add_episode(db_session, not_started, number=1, status=EpisodeStatus.UPCOMING, air_at=now + timedelta(days=1))
    airing_unwatched = add_library_anime(
        db_session,
        external_id='airing-unwatched-filter',
        original_name='Airing Unwatched Filter',
        names=[('Airing Unwatched Filter', 'en')],
    )
    airing_unwatched.total_episodes = 2
    add_episode(db_session, airing_unwatched, number=1, air_at=now - timedelta(days=1))
    add_episode(db_session, airing_unwatched, number=2, status=EpisodeStatus.UPCOMING, air_at=now + timedelta(days=1))
    airing_watched = add_library_anime(
        db_session,
        external_id='airing-watched-filter',
        original_name='Airing Watched Filter',
        names=[('Airing Watched Filter', 'en')],
    )
    airing_watched.total_episodes = 2
    watched_airing_episode = add_episode(db_session, airing_watched, number=1, air_at=now - timedelta(days=1))
    add_episode(db_session, airing_watched, number=2, status=EpisodeStatus.DELAYED, air_at=now + timedelta(days=1))
    completed = add_library_anime(
        db_session,
        external_id='completed-filter',
        original_name='Completed Filter',
        names=[('Completed Filter', 'en')],
        air_date=date(2020, 1, 1),
    )
    completed.total_episodes = 1
    add_episode(db_session, completed, number=1, air_at=now - timedelta(days=120))
    db_session.add(
        UserEpisodeProgress(
            user_id=1,
            episode_id=watched_airing_episode.id,
            watched=True,
            watched_at=now,
        ),
    )
    db_session.commit()

    unwatched_response = client.get('/api/anime/library?unwatched=yes&sort=name&order=asc')
    caught_up_airing_response = client.get('/api/anime/library?unwatched=no&airStatus=airing&sort=name&order=asc')
    not_started_response = client.get('/api/anime/library?airStatus=notStarted&sort=name&order=asc')
    airing_response = client.get('/api/anime/library?airStatus=airing&sort=name&order=asc')
    completed_response = client.get('/api/anime/library?airStatus=completed&sort=name&order=asc')
    invalid_unwatched_response = client.get('/api/anime/library?unwatched=maybe')
    invalid_air_status_response = client.get('/api/anime/library?airStatus=unknown')

    assert [item['anime']['displayName'] for item in unwatched_response.get_json()['items']] == [
        'Airing Unwatched Filter',
        'Completed Filter',
    ]
    assert [item['anime']['displayName'] for item in caught_up_airing_response.get_json()['items']] == [
        'Airing Watched Filter',
    ]
    assert [item['anime']['displayName'] for item in not_started_response.get_json()['items']] == [
        'Not Started Filter',
    ]
    assert [item['anime']['displayName'] for item in airing_response.get_json()['items']] == [
        'Airing Unwatched Filter',
        'Airing Watched Filter',
    ]
    assert [item['anime']['displayName'] for item in completed_response.get_json()['items']] == [
        'Completed Filter',
    ]
    assert invalid_unwatched_response.status_code == 400
    assert invalid_air_status_response.status_code == 400


def test_library_air_status_bounds_unknown_episode_totals_by_recent_activity(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)
    recent = add_library_anime(
        db_session,
        external_id='recent-unknown-total',
        original_name='Recent Unknown Total',
        names=[('Recent Unknown Total', 'en')],
    )
    recent.total_episodes = None
    add_episode(db_session, recent, number=1, air_at=now - timedelta(days=1))
    old = add_library_anime(
        db_session,
        external_id='old-unknown-total',
        original_name='Old Unknown Total',
        names=[('Old Unknown Total', 'en')],
    )
    old.total_episodes = None
    add_episode(db_session, old, number=1, air_at=now - timedelta(days=120))
    db_session.commit()

    airing_response = client.get('/api/anime/library?airStatus=airing&sort=name&order=asc')
    completed_response = client.get('/api/anime/library?airStatus=completed&sort=name&order=asc')

    assert [item['anime']['displayName'] for item in airing_response.get_json()['items']] == [
        'Recent Unknown Total',
    ]
    assert [item['anime']['displayName'] for item in completed_response.get_json()['items']] == [
        'Old Unknown Total',
    ]


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


def test_tracking_list_returns_next_episodes_recently_watched_and_excludes_dropped_or_on_hold(
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

    on_hold_tracking = add_library_anime(
        db_session,
        external_id='on-hold-tracking',
        original_name='On Hold Tracking',
        names=[('On Hold Tracking', 'en')],
        status=UserAnimeStatus.ON_HOLD,
        air_date=date(2026, 7, 4),
    )
    add_episode(db_session, on_hold_tracking, number=1, air_at=now - timedelta(days=1))
    add_episode(db_session, on_hold_tracking, number=2, status=EpisodeStatus.UPCOMING, air_at=now + timedelta(days=5))

    on_hold_backlog = add_library_anime(
        db_session,
        external_id='on-hold-backlog',
        original_name='On Hold Backlog',
        names=[('On Hold Backlog', 'en')],
        status=UserAnimeStatus.ON_HOLD,
        air_date=date(2020, 5, 1),
    )
    on_hold_backlog.total_episodes = 1
    add_episode(db_session, on_hold_backlog, number=1, air_at=now - timedelta(days=100))

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


def test_tracking_list_season_zero_preference_only_affects_unwatched_queue(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)
    season_zero = add_library_anime(
        db_session,
        provider_type='tvdb',
        external_id='123:0',
        original_name='Specials',
        names=[('Specials', 'en')],
        air_date=date(2020, 1, 1),
    )
    season_zero.total_episodes = 2
    watched_special = add_episode(db_session, season_zero, number=1, air_at=now - timedelta(days=100))
    add_episode(db_session, season_zero, number=2, air_at=now - timedelta(days=99))
    normal = add_library_anime(
        db_session,
        external_id='normal-backlog',
        original_name='Normal Backlog',
        names=[('Normal Backlog', 'en')],
        air_date=date(2021, 1, 1),
    )
    normal.total_episodes = 1
    add_episode(db_session, normal, number=1, air_at=now - timedelta(days=90))
    db_session.add(UserEpisodeProgress(user_id=1, episode_id=watched_special.id, watched=True, watched_at=now))
    db_session.commit()

    default_backlog = client.get('/api/watch-state/tracking-list/backlog')
    recent_response = client.get('/api/watch-state/tracking-list/recently-watched')
    assert client.patch('/api/user/me/preferences', json={'includeUnwatchedSeasonZeroInTracking': True}).status_code == 200
    included_backlog = client.get('/api/watch-state/tracking-list/backlog')

    assert default_backlog.status_code == 200
    assert [item['anime']['displayName'] for item in default_backlog.get_json()['items']] == ['Normal Backlog']
    assert recent_response.status_code == 200
    assert [item['anime']['displayName'] for item in recent_response.get_json()['items']] == ['Specials']
    assert included_backlog.status_code == 200
    assert [item['anime']['displayName'] for item in included_backlog.get_json()['items']] == ['Normal Backlog', 'Specials']


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


def test_statistics_season_zero_preference_only_affects_unwatched_aired(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    now = datetime.now(UTC)
    normal = add_library_anime(
        db_session,
        external_id='normal-stats',
        original_name='Normal Stats',
        names=[('Normal Stats', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    season_zero = add_library_anime(
        db_session,
        provider_type='tvdb',
        external_id='456:0',
        original_name='Stats Specials',
        names=[('Stats Specials', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    add_episode(db_session, normal, number=1)
    watched_special = add_episode(db_session, season_zero, number=1)
    add_episode(db_session, season_zero, number=2)
    local_season_zero = add_library_anime(
        db_session,
        provider_type='tmdb',
        external_id='tv:789:season:1',
        original_name='Local Stats Specials',
        names=[('Local Stats Specials', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    local_progress = db_session.scalar(
        select(UserAnimeProgress).where(UserAnimeProgress.anime_id == local_season_zero.id),
    )
    assert local_progress is not None
    local_snapshot = UserAnimeMetadataSnapshot(
        user_id=1,
        anime_id=local_season_zero.id,
        source_anime_id=local_season_zero.id,
        source_provider='tmdb',
        source_external_id='tv:789:season:0',
        source_title='Frozen Local Stats Specials',
        episode_count=1,
    )
    db_session.add(local_snapshot)
    db_session.flush()
    db_session.add(
        UserAnimeMetadataEpisodeSnapshot(
            snapshot_id=local_snapshot.id,
            episode_number=1,
            status=EpisodeStatus.AIRED.value,
            watched=False,
        ),
    )
    local_progress.metadata_source = 'local_snapshot'
    local_progress.metadata_snapshot_id = local_snapshot.id
    db_session.add(UserEpisodeProgress(user_id=1, episode_id=watched_special.id, watched=True, watched_at=now))
    db_session.commit()

    default_response = client.get('/api/statistics/summary')
    assert client.patch('/api/user/me/preferences', json={'includeUnwatchedSeasonZeroInStatistics': True}).status_code == 200
    included_response = client.get('/api/statistics/summary')

    assert default_response.status_code == 200
    default_body = default_response.get_json()
    assert default_body['watchedEpisodeCount'] == 1
    assert default_body['unwatchedAiredEpisodeCount'] == 1
    assert included_response.status_code == 200
    included_body = included_response.get_json()
    assert included_body['watchedEpisodeCount'] == 1
    assert included_body['unwatchedAiredEpisodeCount'] == 3


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


def test_statistics_uses_only_each_animes_active_episode_source(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='local-statistics',
        original_name='Upstream Statistics Name',
        names=[('Upstream Statistics Name', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    upstream_episode = add_episode(db_session, anime, number=1, duration='00:24:00')
    progress = db_session.scalar(select(UserAnimeProgress).where(UserAnimeProgress.anime_id == anime.id))
    assert progress is not None
    snapshot = UserAnimeMetadataSnapshot(
        user_id=1,
        anime_id=anime.id,
        source_anime_id=anime.id,
        source_provider='bangumi',
        source_external_id='local-statistics',
        source_title='Frozen Statistics Name',
        episode_count=2,
    )
    db_session.add(snapshot)
    db_session.flush()
    local_watched = UserAnimeMetadataEpisodeSnapshot(
        snapshot_id=snapshot.id,
        episode_number=1,
        title='Frozen Episode',
        duration='00:25:00',
        status=EpisodeStatus.AIRED.value,
        watched=True,
        watched_at=datetime(2026, 7, 17, 1, tzinfo=UTC),
    )
    local_unwatched = UserAnimeMetadataEpisodeSnapshot(
        snapshot_id=snapshot.id,
        episode_number=2,
        duration='00:25:00',
        status=EpisodeStatus.AIRED.value,
        watched=False,
    )
    db_session.add_all(
        [
            local_watched,
            local_unwatched,
            UserEpisodeProgress(
                user_id=1,
                episode_id=upstream_episode.id,
                watched=True,
                watched_at=datetime(2026, 7, 16, 1, tzinfo=UTC),
            ),
        ],
    )
    progress.metadata_source = 'local_snapshot'
    progress.metadata_snapshot_id = snapshot.id
    db_session.commit()

    summary = client.get('/api/statistics/summary').get_json()
    timeline = client.get('/api/watch-state/watch-timeline').get_json()

    assert summary['watchedEpisodeCount'] == 1
    assert summary['unwatchedAiredEpisodeCount'] == 1
    assert summary['totalWatchSeconds'] == 25 * 60
    assert timeline['total'] == 1
    assert timeline['items'][0]['anime']['displayName'] == 'Frozen Statistics Name'
    assert timeline['items'][0]['episode']['id'] == local_watched.id
    assert timeline['items'][0]['episode']['source'] == 'local_snapshot'


def test_statistics_groups_summary_and_timeline_in_user_timezone(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    assert client.patch('/api/user/me/preferences', json={'timeZone': 'Asia/Shanghai'}).status_code == 200
    anime = add_library_anime(
        db_session,
        external_id='timezone-statistics',
        original_name='Timezone Statistics',
        names=[('Timezone Statistics', 'en')],
        status=UserAnimeStatus.WATCHING,
    )
    episode = add_episode(db_session, anime, number=1, duration='00:24:00')
    db_session.add(
        UserEpisodeProgress(
            user_id=1,
            episode_id=episode.id,
            watched=True,
            watched_at=datetime(2026, 7, 16, 18, 30, tzinfo=UTC),
        ),
    )
    db_session.commit()

    summary = client.get('/api/statistics/summary').get_json()
    timeline = client.get('/api/watch-state/watch-timeline').get_json()

    assert summary['timeZone'] == 'Asia/Shanghai'
    assert next(day for day in summary['daily'] if day['date'] == '2026-07-17')['watchedEpisodeCount'] == 1
    assert timeline['timeZone'] == 'Asia/Shanghai'
    assert timeline['items'][0]['episode']['localDate'] == '2026-07-17'
    assert timeline['items'][0]['episode']['watchedAt'].endswith('Z')


def test_statistics_queries_remain_bounded_and_timeline_paginates_in_sql(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    watched_at = datetime(2026, 7, 18, 12, tzinfo=UTC)
    for index in range(12):
        anime = add_library_anime(
            db_session,
            external_id=f'statistics-query-count-{index}',
            original_name=f'Statistics Query Count {index}',
            names=[(f'Statistics Query Count {index}', 'en')],
            status=UserAnimeStatus.WATCHING,
        )
        episode = add_episode(db_session, anime, number=1, duration='00:24:00')
        db_session.add(
            UserEpisodeProgress(
                user_id=1,
                episode_id=episode.id,
                watched=True,
                watched_at=watched_at + timedelta(minutes=index),
            ),
        )
    db_session.commit()
    user = db_session.get(User, 1)
    assert user is not None
    statements: list[str] = []

    def capture_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:  # type: ignore[no-untyped-def]
        statements.append(statement)

    engine = db_session.get_bind()
    event.listen(engine, 'before_cursor_execute', capture_statement)
    try:
        get_statistics_summary(db_session, user)
        summary_query_count = len(statements)
        statements.clear()
        timeline = get_watch_timeline(db_session, user, limit=2, offset=1)
        timeline_statements = list(statements)
    finally:
        event.remove(engine, 'before_cursor_execute', capture_statement)

    assert summary_query_count == 3
    assert len(timeline_statements) <= 8
    assert len(timeline['items']) == 2
    assert timeline['total'] == 12
    assert any(
        'active_statistics_episodes' in statement and 'LIMIT' in statement and 'OFFSET' in statement
        for statement in timeline_statements
    )


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
    assert body['airStatus'] == 'notStarted'
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

    original_name_response = client.patch('/api/anime/library/1/episodes/1/name-preference', json={'nameId': 1})
    refreshed_episode = client.get('/api/anime/library/1/episodes').get_json()['episodes'][0]

    assert original_name_response.status_code == 200
    assert original_name_response.get_json()['episode']['preferredNameId'] == 1
    assert refreshed_episode['preferredNameId'] == 1
    assert refreshed_episode['displayName'] == '旅立ちの終わり'


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


def test_queue_airing_anime_sync_requires_login(client: FlaskClient) -> None:
    response = client.post('/api/anime/airing/sync')

    assert response.status_code == 401
    assert response.get_json() == {'message': 'Authentication required'}


def test_queue_airing_anime_sync_reuses_active_job_and_supports_polling(
    app: Flask,
    client: FlaskClient,
    test_instance_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import anime_info

    assert register_user(client).status_code == 201
    app.config['LIBRARY_REFRESH_JOB_LOCK_DIR'] = str(test_instance_path / 'airing-refresh-locks')

    @dataclass(frozen=True)
    class Result:
        id: str

    queued_task_ids: list[str] = []

    def apply_async(*, args, task_id):  # type: ignore[no-untyped-def]
        assert args[1] == app.config['LIBRARY_REFRESH_JOB_LOCK_DIR']
        assert args[2] == task_id
        queued_task_ids.append(task_id)
        return Result(id=task_id)

    monkeypatch.setattr(anime_info.refresh_airing_anime, 'apply_async', apply_async)

    first = client.post('/api/anime/airing/sync')
    second = client.post('/api/anime/airing/sync')

    assert first.status_code == 202
    assert second.status_code == 202
    first_body = first.get_json()
    second_body = second.get_json()
    assert first_body['queued'] is True
    assert first_body['job']['jobId'] == first_body['taskId']
    assert first_body['job']['status'] == 'queued'
    assert second_body['queued'] is False
    assert second_body['job']['jobId'] == first_body['taskId']
    assert queued_task_ids == [first_body['taskId']]

    current = client.get('/api/anime/airing/sync')
    by_id = client.get(f"/api/anime/airing/sync/{first_body['taskId']}")
    library_refresh = client.get('/api/anime/library/sync-all')

    assert current.status_code == 200
    assert by_id.status_code == 200
    assert current.get_json()['job']['jobId'] == first_body['taskId']
    assert by_id.get_json()['jobId'] == first_body['taskId']
    assert library_refresh.status_code == 200
    assert library_refresh.get_json() == {'job': None}


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

    progress_updates: list[dict[str, object]] = []
    summary = anime_sync_task.sync_airing_anime_metadata(progress_updates.append)

    assert summary['checked'] == 3
    assert summary['synced'] == 2
    assert summary['failed'] == 1
    assert provider.detail_calls == ['upcoming', 'unknown', 'partial']
    assert progress_updates[0]['processed'] == 0
    assert progress_updates[0]['total'] == 3
    assert progress_updates[-1]['processed'] == 3
    assert progress_updates[-1]['synced'] == 2
    assert progress_updates[-1]['failed'] == 1


def test_refresh_airing_anime_task_persists_progress_and_releases_lock(
    test_instance_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.library_refresh_jobs import (
        acquire_library_refresh_lock,
        load_library_refresh_job,
        store_library_refresh_job,
    )
    from app.tasks import anime_sync as anime_sync_task

    job_dir = test_instance_path / 'airing-refresh-jobs'
    job_id = 'airingjob'
    lock = acquire_library_refresh_lock(user_id=0, task_id=job_id, lock_dir=str(job_dir))
    store_library_refresh_job(
        job_dir,
        job_id,
        {'jobId': job_id, 'userId': 1, 'kind': 'airing_anime_sync', 'status': 'queued', 'progress': None, 'summary': None},
    )

    def sync(progress_callback):  # type: ignore[no-untyped-def]
        progress_callback({'processed': 1, 'total': 2, 'synced': 1, 'failed': 0, 'episodeConflicts': 0, 'postersQueued': 1})
        progress_callback({'processed': 2, 'total': 2, 'synced': 2, 'failed': 0, 'episodeConflicts': 0, 'postersQueued': 1})
        return {'checked': 2, 'synced': 2, 'failed': 0, 'episodeConflicts': 0, 'postersQueued': 1}

    monkeypatch.setattr(anime_sync_task, 'sync_airing_anime_metadata', sync)

    summary = anime_sync_task.refresh_airing_anime(lock.lock_path, str(job_dir), job_id)

    job = load_library_refresh_job(job_dir, job_id)
    assert summary['synced'] == 2
    assert job is not None
    assert job['status'] == 'completed'
    assert job['progress']['percent'] == 100
    assert job['summary'] == summary
    assert not Path(lock.lock_path).exists()


def test_celery_beat_schedule_defaults_and_env_override() -> None:
    configure_celery(
        {
            'CELERY_BROKER_URL': 'memory://',
            'ANIME_SYNC_CRON_HOUR': '4,12,20',
            'ANIME_SYNC_CRON_MINUTE': 0,
            'UNTRACKED_ANIME_CLEANUP_DISABLED': False,
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

    assert default_schedule.hour == {4, 12, 20}
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


def test_bangumi_related_anime_discovery_skips_already_matched_related_anime(
    app: Flask,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.tasks.bangumi_related_anime_discovery import discover_bangumi_related_anime_for_user

    current = add_library_anime(db_session, external_id='current', original_name='Current', names=[('Current', 'en')])
    related = add_library_anime(db_session, external_id='related', original_name='Related', names=[('Related', 'en')])
    db_session.add(
        AnimeRelation(
            anime_id=current.id,
            related_anime_id=related.id,
            provider_type='bangumi',
            external_id='related',
            relation_type='same_series_season',
            title='Related',
        ),
    )
    db_session.commit()
    provider = MutableDetailProvider(
        {
            'current': anime_detail('current', title='Current'),
            'related': anime_detail('related', title='Related'),
        },
    )

    class Factory:
        @classmethod
        def from_config(cls, _config):  # type: ignore[no-untyped-def]
            return ImportProviderFactory({'bangumi': provider})

    monkeypatch.setenv('AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED', 'true')
    monkeypatch.setattr('app.tasks.bangumi_related_anime_discovery.ImportProviderFactory', Factory)
    monkeypatch.setattr('app.services.related_anime_discovery.enqueue_poster_download', lambda _poster_id: None)
    celery_app.conf.database_url = app.config['DATABASE_URL']

    summary = discover_bangumi_related_anime_for_user(1)

    assert summary['checked'] == 1
    assert provider.detail_calls == ['current']


def test_related_anime_discovery_skips_overridden_relation_until_provider_import_allowed(
    db_session: Session,
) -> None:
    from app.services.related_anime_discovery import discover_related_anime_for_user_anime

    current = AnimeMetaInfo(provider_type='bangumi', external_id='current', original_name='Current')
    mapped = AnimeMetaInfo(provider_type='tvdb', external_id='mini', original_name='Mapped Mini Anime')
    db_session.add_all([current, mapped])
    db_session.flush()
    relation = AnimeRelation(
        anime_id=current.id,
        provider_type='bangumi',
        external_id='season-0',
        relation_type='same_series_season',
        title='Season 0',
    )
    db_session.add(relation)
    db_session.flush()
    db_session.add(UserAnimeProgress(user_id=1, anime_id=current.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    db_session.add(UserAnimeProgress(user_id=1, anime_id=mapped.id, status=UserAnimeStatus.PLAN_TO_WATCH))
    override = UserAnimeRelationOverride(user_id=1, anime_relation_id=relation.id, related_anime_id=mapped.id)
    db_session.add(override)
    db_session.commit()
    related_item = ImportRelatedAnime(
        provider='bangumi',
        external_id='season-0',
        relation_type='same_series_season',
        title='Season 0',
        season_number=0,
        air_date=None,
        episode_count=1,
        url='https://bgm.tv/subject/season-0',
        poster_source_url=None,
        raw_data={'id': 'season-0'},
    )
    provider = MutableDetailProvider(
        {
            'current': replace(anime_detail('current', title='Current'), related_anime=[related_item]),
            'season-0': anime_detail('season-0', title='Season 0'),
        },
    )

    result = discover_related_anime_for_user_anime(db_session, provider, user_id=1, anime_id=current.id, provider_name='bangumi')

    assert result.imported_anime_ids == []
    assert result.existing_anime_ids == [mapped.id]
    assert db_session.scalar(select(AnimeMetaInfo).where(AnimeMetaInfo.provider_type == 'bangumi', AnimeMetaInfo.external_id == 'season-0')) is None

    override.allow_provider_import = True
    db_session.commit()
    result = discover_related_anime_for_user_anime(db_session, provider, user_id=1, anime_id=current.id, provider_name='bangumi')

    imported = db_session.scalar(select(AnimeMetaInfo).where(AnimeMetaInfo.provider_type == 'bangumi', AnimeMetaInfo.external_id == 'season-0'))
    assert imported is not None
    assert result.imported_anime_ids == [imported.id]


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
            'UNTRACKED_ANIME_CLEANUP_DISABLED': False,
            'UNTRACKED_ANIME_CLEANUP_CRON_MONTHS': 'not-a-month',
            'UNTRACKED_ANIME_CLEANUP_CRON_DAY': 7,
            'UNTRACKED_ANIME_CLEANUP_CRON_HOUR': 8,
            'UNTRACKED_ANIME_CLEANUP_CRON_MINUTE': 9,
        },
    )

    cleanup_schedule = celery_app.conf.beat_schedule['delete-untracked-anime']['schedule']

    assert cleanup_schedule.month_of_year == {2, 5, 8, 11}


def test_celery_beat_schedule_can_disable_delete_untracked_anime() -> None:
    configure_celery(
        {
            'CELERY_BROKER_URL': 'memory://',
            'UNTRACKED_ANIME_CLEANUP_DISABLED': True,
        },
    )

    assert 'sync-airing-anime' in celery_app.conf.beat_schedule
    assert 'delete-untracked-anime' not in celery_app.conf.beat_schedule


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


def test_switch_to_local_snapshot_returns_snapshot_episodes(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    install_provider(app)
    assert register_user(client).status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201
    assert client.patch('/api/watch-state/anime/1/episodes/1', json={'watched': True}).status_code == 200

    response = client.post('/api/anime/library/1/provider-switch', json={'provider': 'local'})

    assert response.status_code == 200
    body = response.get_json()
    assert body['progress']['metadataSource'] == 'local_snapshot'
    assert body['progress']['hasLocalSnapshot'] is True
    assert body['metadataSnapshot']['episodeCount'] == 2
    progress = db_session.scalar(select(UserAnimeProgress).where(UserAnimeProgress.anime_id == 1))
    snapshot = db_session.scalar(select(UserAnimeMetadataSnapshot))
    assert progress is not None
    assert snapshot is not None
    assert progress.metadata_snapshot_id == snapshot.id

    episodes_response = client.get('/api/anime/library/1/episodes')
    assert episodes_response.status_code == 200
    episodes = episodes_response.get_json()['episodes']
    assert [episode['episodeNumber'] for episode in episodes] == [1, 2]
    assert episodes[0]['watched'] is True
    assert episodes[0]['displayName'] == '旅立ちの終わり'
    assert episodes[0]['airAtPrecision'] == 'date'
    assert episodes[0]['availableNames'] == []

    watched = client.get('/api/anime/library/1/episodes', query_string={'filter': 'watched'}).get_json()
    assert watched['total'] == 1
    assert [episode['episodeNumber'] for episode in watched['episodes']] == [1]

    searched = client.get('/api/anime/library/1/episodes', query_string={'q': '旅立ち'}).get_json()
    assert [episode['episodeNumber'] for episode in searched['episodes']] == [1]

    located = client.get(
        '/api/anime/library/1/episodes',
        query_string={'limit': 1, 'order': 'desc', 'locateEpisodeNumber': 1},
    ).get_json()
    assert located['page'] == 2
    assert located['location']['episodeNumber'] == 1
    assert [episode['episodeNumber'] for episode in located['episodes']] == [1]
    assert [(item['firstEpisodeNumber'], item['lastEpisodeNumber']) for item in located['ranges']] == [(2, 2), (1, 1)]


def test_local_snapshot_watch_state_updates_snapshot_episode(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    install_provider(app)
    assert register_user(client).status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201
    assert client.post('/api/anime/library/1/provider-switch', json={'provider': 'local'}).status_code == 200
    snapshot_episode = db_session.scalar(
        select(UserAnimeMetadataEpisodeSnapshot).where(UserAnimeMetadataEpisodeSnapshot.episode_number == 2),
    )
    assert snapshot_episode is not None

    response = client.patch(
        f'/api/watch-state/anime/1/episodes/{snapshot_episode.id}',
        json={'watched': True, 'watchedAt': '2020-01-02T03:04:05+09:00'},
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body['episode']['watched'] is True
    assert body['episode']['watchedAt'].startswith('2020-01-01T18:04:05')
    db_session.refresh(snapshot_episode)
    assert snapshot_episode.watched is True
    assert snapshot_episode.watched_at == datetime(2020, 1, 1, 18, 4, 5)
    assert db_session.scalar(select(UserEpisodeProgress).where(UserEpisodeProgress.watched.is_(True))) is None

    bulk_response = client.patch('/api/watch-state/anime/1/episodes/watched-at')

    assert bulk_response.status_code == 200
    assert bulk_response.get_json()['matchedCount'] == 1
    db_session.refresh(snapshot_episode)
    assert snapshot_episode.watched_at == snapshot_episode.air_at


def test_sync_conflict_creates_local_snapshot_before_pruning(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    provider = MutableDetailProvider(
        {
            '493042': anime_detail('493042', episodes=[episode_info(1, title='Episode 1'), episode_info(2, title='Episode 2')]),
        },
    )
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    assert register_user(client).status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201
    episode_2 = db_session.scalar(select(Episode).where(Episode.episode_number == 2))
    assert episode_2 is not None
    assert client.patch(f'/api/watch-state/anime/1/episodes/{episode_2.id}', json={'watched': True}).status_code == 200
    provider.details['493042'] = anime_detail('493042', episodes=[episode_info(1, title='Episode 1')], total_episodes=1)

    response = client.post('/api/anime/library/1/sync')

    assert response.status_code == 200
    body = response.get_json()
    assert body['episodeConflicts'][0]['episodeNumber'] == 2
    snapshot = db_session.scalar(select(UserAnimeMetadataSnapshot))
    assert snapshot is not None
    snapshot_episodes = db_session.scalars(
        select(UserAnimeMetadataEpisodeSnapshot).where(UserAnimeMetadataEpisodeSnapshot.snapshot_id == snapshot.id).order_by(UserAnimeMetadataEpisodeSnapshot.episode_number),
    ).all()
    assert [episode.episode_number for episode in snapshot_episodes] == [1, 2]
    assert snapshot_episodes[1].watched is True


def test_anime_detail_returns_metadata_snapshot_summary(
    app: Flask,
    client: FlaskClient,
) -> None:
    install_provider(app)
    assert register_user(client).status_code == 201
    assert client.post('/api/anime/library', json={'provider': 'bangumi', 'externalId': '493042'}).status_code == 201
    assert client.post('/api/anime/library/1/provider-switch', json={'provider': 'local'}).status_code == 200

    response = client.get('/api/anime/1')

    assert response.status_code == 200
    body = response.get_json()
    assert body['progress']['metadataSource'] == 'local_snapshot'
    assert body['progress']['hasLocalSnapshot'] is True
    assert body['metadataSnapshot']['sourceProvider'] == 'bangumi'
    assert body['metadataSnapshot']['episodeCount'] == 2
    assert body['episodeConflicts'] == []


def test_bulk_episode_watch_state_applies_to_full_collection(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(db_session, external_id='bulk', original_name='Bulk', names=[])
    episodes = [
        add_episode(db_session, anime, number=number, status=EpisodeStatus.AIRED if number <= 35 else EpisodeStatus.UPCOMING)
        for number in range(1, 41)
    ]
    db_session.commit()

    response = client.patch(
        f'/api/watch-state/anime/{anime.id}/episodes',
        json={'watched': True, 'scope': 'aired'},
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body['matchedCount'] == 35
    assert body['changedCount'] == 35
    watched_ids = set(db_session.scalars(select(UserEpisodeProgress.episode_id).where(UserEpisodeProgress.watched.is_(True))).all())
    assert watched_ids == {episode.id for episode in episodes[:35]}

    clear_response = client.patch(
        f'/api/watch-state/anime/{anime.id}/episodes',
        json={'watched': False, 'scope': 'all'},
    )
    assert clear_response.status_code == 200
    assert db_session.scalars(select(UserEpisodeProgress.id).where(UserEpisodeProgress.watched.is_(True))).all() == []


def test_bulk_episode_watch_state_validates_through_scope(client: FlaskClient, db_session: Session) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(db_session, external_id='bulk-invalid', original_name='Bulk Invalid', names=[])

    response = client.patch(
        f'/api/watch-state/anime/{anime.id}/episodes',
        json={'watched': True, 'scope': 'through', 'throughEpisodeNumber': 0},
    )

    assert response.status_code == 400


def test_episode_watch_state_accepts_custom_watched_at(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(
        db_session,
        external_id='watch-time',
        original_name='Watch Time',
        names=[],
    )
    episode = add_episode(db_session, anime, number=1)
    db_session.commit()

    response = client.patch(
        f'/api/watch-state/anime/{anime.id}/episodes/{episode.id}',
        json={'watched': True, 'watchedAt': '2021-06-07T20:30:00+08:00'},
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body['episode']['watchedAt'].startswith('2021-06-07T12:30:00')
    assert body['progress']['lastWatchedAt'].startswith('2021-06-07T12:30:00')
    watch_progress = db_session.scalar(
        select(UserEpisodeProgress).where(UserEpisodeProgress.episode_id == episode.id),
    )
    assert watch_progress is not None
    assert watch_progress.watched_at == datetime(2021, 6, 7, 12, 30)


def test_episode_watch_times_can_be_set_to_each_air_time_in_bulk(
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(db_session, external_id='bulk-watch-times', original_name='Bulk Watch Times', names=[])
    first = add_episode(db_session, anime, number=1, air_at=datetime(2020, 1, 1, 12, tzinfo=UTC))
    second = add_episode(db_session, anime, number=2, air_at=datetime(2020, 1, 8, 12, tzinfo=UTC))
    without_air_time = add_episode(db_session, anime, number=3)
    unwatched = add_episode(db_session, anime, number=4, air_at=datetime(2020, 1, 22, 12, tzinfo=UTC))
    db_session.add_all([
        UserEpisodeProgress(user_id=1, episode_id=first.id, watched=True, watched_at=datetime(2026, 1, 1, tzinfo=UTC)),
        UserEpisodeProgress(user_id=1, episode_id=second.id, watched=True, watched_at=datetime(2026, 1, 2, tzinfo=UTC)),
        UserEpisodeProgress(user_id=1, episode_id=without_air_time.id, watched=True, watched_at=datetime(2026, 1, 3, tzinfo=UTC)),
    ])
    db_session.commit()

    response = client.patch(f'/api/watch-state/anime/{anime.id}/episodes/watched-at')

    assert response.status_code == 200
    body = response.get_json()
    assert body['matchedCount'] == 2
    assert body['changedCount'] == 2
    db_session.expire_all()
    progresses = {
        item.episode_id: item
        for item in db_session.scalars(select(UserEpisodeProgress)).all()
    }
    assert progresses[first.id].watched_at == first.air_at
    assert progresses[second.id].watched_at == second.air_at
    assert progresses[without_air_time.id].watched_at == datetime(2026, 1, 3)
    assert unwatched.id not in progresses


@pytest.mark.parametrize(
    'payload',
    [
        {'watched': True, 'watchedAt': 'not-a-date'},
        {'watched': True, 'watchedAt': '2021-06-07T12:30:00'},
        {'watched': False, 'watchedAt': '2021-06-07T12:30:00+00:00'},
    ],
)
def test_episode_watch_state_rejects_invalid_custom_watched_at(
    client: FlaskClient,
    db_session: Session,
    payload: dict[str, object],
) -> None:
    assert register_user(client).status_code == 201
    anime = add_library_anime(
        db_session,
        external_id=f'invalid-watch-time-{payload}',
        original_name='Invalid Watch Time',
        names=[],
    )
    episode = add_episode(db_session, anime, number=1)
    db_session.commit()

    response = client.patch(
        f'/api/watch-state/anime/{anime.id}/episodes/{episode.id}',
        json=payload,
    )

    assert response.status_code == 400


def test_provider_switch_conflict_requires_confirmation_before_migration(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    source = add_library_anime(db_session, external_id='source', original_name='Source', names=[('Source', 'en')])
    watched = add_episode(db_session, source, number=2, title='Source Episode 2')
    db_session.add(UserEpisodeProgress(user_id=1, episode_id=watched.id, watched=True, watched_at=datetime.now(UTC)))
    db_session.commit()
    provider = NamedMutableDetailProvider('tvdb', {'target': replace(anime_detail('target', episodes=[episode_info(1, title='Target Episode 1')], total_episodes=1), provider='tvdb')})
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': FakeProvider(), 'tvdb': provider})

    conflict_response = client.post(
        f'/api/anime/library/{source.id}/provider-switch',
        json={'provider': 'tvdb', 'externalId': 'target'},
    )

    assert conflict_response.status_code == 409
    conflict_body = conflict_response.get_json()
    assert conflict_body['episodeConflicts'][0]['episodeNumber'] == 2
    db_session.expire_all()
    progress = db_session.scalar(select(UserAnimeProgress).where(UserAnimeProgress.user_id == 1))
    assert progress is not None
    assert progress.anime_id == source.id
    assert db_session.scalar(select(AnimeMetaInfo).where(AnimeMetaInfo.provider_type == 'tvdb')) is None

    confirm_response = client.post(
        f'/api/anime/library/{source.id}/provider-switch',
        json={'provider': 'tvdb', 'externalId': 'target', 'confirm': True},
    )

    assert confirm_response.status_code == 200
    assert confirm_response.get_json()['episodeConflicts'][0]['episodeNumber'] == 2
    db_session.expire_all()
    progress = db_session.scalar(select(UserAnimeProgress).where(UserAnimeProgress.user_id == 1))
    assert progress is not None
    assert progress.anime.provider_type == 'tvdb'
