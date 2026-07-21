from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import pytest
import requests
from flask import Flask
from flask.testing import FlaskClient

import app.api.anime_info as anime_api
from app import create_app
from app.import_provider.bangumi import BangumiImportProvider
from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import (
    ImportProviderResponseError,
    ImportProviderTimeoutError,
)
from app.import_provider.factory import ImportProviderFactory
from app.import_provider.types import ImportAnimeDetail, ImportSearchPage, ImportSearchResult
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


class FakeProvider(ImportProvider):
    name = 'bangumi'

    def __init__(self, page: ImportSearchPage | None = None, error: Exception | None = None) -> None:
        self.page = page or ImportSearchPage(total=0, limit=20, offset=0, results=[])
        self.error = error
        self.calls: list[tuple[str, int, int]] = []

    def search_anime(self, keyword: str, *, limit: int, offset: int, language: str | None = None) -> ImportSearchPage:
        _ = language
        self.calls.append((keyword, limit, offset))
        if self.error is not None:
            raise self.error
        return self.page

    def get_anime_detail(self, _external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
        _ = language
        raise NotImplementedError


class SlowSearchProvider(FakeProvider):
    def search_anime(self, keyword: str, *, limit: int, offset: int, language: str | None = None) -> ImportSearchPage:
        time.sleep(1)
        return super().search_anime(keyword, limit=limit, offset=offset, language=language)


class FakeTvdbSeasonProvider(FakeProvider):
    name = 'tvdb'

    def get_series_seasons(self, external_id: str, *, language: str | None = None) -> list[ImportSearchResult]:
        _ = language
        assert external_id == '321:1'
        return self.page.results


class FakeResponse:
    def __init__(self, status_code: int, body: object) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> object:
        if isinstance(self._body, ValueError):
            raise self._body
        return self._body


class FakeSession:
    def __init__(self, response: FakeResponse | list[FakeResponse] | None = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        return self._request(url, **kwargs)

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        return self._request(url, **kwargs)

    def _request(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({'url': url, **kwargs})
        if self.error is not None:
            raise self.error
        assert self.response is not None
        if isinstance(self.response, list):
            return self.response.pop(0)
        return self.response


def test_search_keyword_is_required(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201
    response = client.get('/api/anime/search?q=   ')

    assert response.status_code == 400
    assert response.get_json() == {'message': 'Search keyword is required'}


def test_search_limit_above_max_is_invalid(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201
    response = client.get('/api/anime/search?q=frieren&limit=51')

    assert response.status_code == 400
    assert response.get_json() == {'message': 'Search limit is invalid'}


def test_search_negative_offset_is_invalid(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201
    response = client.get('/api/anime/search?q=frieren&offset=-1')

    assert response.status_code == 400
    assert response.get_json() == {'message': 'Search offset is invalid'}


def test_search_uses_provider_factory_and_serializes_results(app: Flask, client: FlaskClient) -> None:
    raw_data = {'id': 493042, 'type': 2}
    result = ImportSearchResult(
        provider='bangumi',
        external_id='493042',
        title='葬送的芙莉莲',
        original_title='葬送のフリーレン',
        summary='summary',
        air_date='2023-09-29',
        platform='TV',
        episode_count=28,
        image_url='https://example.test/cover.jpg',
        url='https://bgm.tv/subject/493042',
        raw_data=raw_data,
    )
    provider = FakeProvider(ImportSearchPage(total=1, limit=10, offset=2, results=[result]))
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': provider})
    assert register_user(client).status_code == 201

    response = client.get('/api/anime/search?q=frieren&limit=10&offset=2')

    assert response.status_code == 200
    assert provider.calls == [('frieren', 10, 2)]
    assert response.get_json() == {
        'total': 1,
        'limit': 10,
        'offset': 2,
        'results': [
            {
                'provider': 'bangumi',
                'externalId': '493042',
                'title': '葬送的芙莉莲',
                'originalTitle': '葬送のフリーレン',
                'summary': 'summary',
                'airDate': '2023-09-29',
                'platform': 'TV',
                'episodeCount': 28,
                'imageUrl': 'https://example.test/cover.jpg',
                'url': 'https://bgm.tv/subject/493042',
                'rawData': raw_data,
                'inLibrary': False,
                'animeId': None,
                'libraryStatus': None,
            },
        ],
    }


def test_search_requires_login(client: FlaskClient) -> None:
    response = client.get('/api/anime/search?q=frieren')

    assert response.status_code == 401
    assert response.get_json() == {'message': 'Authentication required'}


def test_api_layer_does_not_import_bangumi_provider() -> None:
    assert 'BangumiImportProvider' not in anime_api.__dict__


def test_provider_instance_is_initialized_once_and_reused(app: Flask) -> None:
    factory = app.extensions['import_provider_factory']
    assert isinstance(factory, ImportProviderFactory)

    first_provider = factory.get_provider('bangumi')
    second_provider = factory.get_provider('bangumi')

    assert first_provider is second_provider


def test_api_maps_provider_errors(client: FlaskClient, app: Flask) -> None:
    assert register_user(client).status_code == 201
    app.extensions['import_provider_factory'] = ImportProviderFactory(
        {'bangumi': FakeProvider(error=ImportProviderResponseError('bad response'))},
    )
    response = client.get('/api/anime/search?q=frieren')
    assert response.status_code == 502

    app.extensions['import_provider_factory'] = ImportProviderFactory(
        {'bangumi': FakeProvider(error=ImportProviderTimeoutError('timeout'))},
    )
    response = client.get('/api/anime/search?q=frieren')
    assert response.status_code == 504


def test_search_deadline_maps_blocked_provider_to_timeout(client: FlaskClient, app: Flask) -> None:
    assert register_user(client).status_code == 201
    app.config['IMPORT_SEARCH_TIMEOUT'] = 0.01
    app.extensions['import_provider_factory'] = ImportProviderFactory({'bangumi': SlowSearchProvider()})

    response = client.get('/api/anime/search?q=frieren')

    assert response.status_code == 504
    assert response.get_json() == {'message': 'Import provider request timed out'}


def test_tvdb_seasons_endpoint_serializes_season_results(client: FlaskClient, app: Flask) -> None:
    assert register_user(client).status_code == 201
    app.extensions['import_provider_factory'] = ImportProviderFactory(
        {
            'tvdb': FakeTvdbSeasonProvider(
                ImportSearchPage(
                    total=1,
                    limit=1,
                    offset=0,
                    results=[
                        ImportSearchResult(
                            provider='tvdb',
                            external_id='321:1',
                            title='Example Anime Season 1',
                            original_title='Example Anime',
                            summary='summary',
                            air_date=None,
                            platform='tv',
                            episode_count=12,
                            image_url=None,
                            url='https://thetvdb.com/series/example/seasons/official/1',
                            raw_data={},
                        ),
                    ],
                ),
            ),
        },
    )

    response = client.get('/api/anime/tvdb/seasons?externalId=321:1')

    assert response.status_code == 200
    body = response.get_json()
    assert body['results'][0]['externalId'] == '321:1'
    assert body['results'][0]['title'] == 'Example Anime Season 1'
    assert body['results'][0]['inLibrary'] is False


def test_bangumi_provider_maps_response_to_import_search_results() -> None:
    session = FakeSession(
        FakeResponse(
            200,
            {
                'total': 1,
                'limit': 20,
                'offset': 0,
                'data': [
                    {
                        'id': 493042,
                        'name': '葬送のフリーレン',
                        'name_cn': '葬送的芙莉莲',
                        'summary': 'summary',
                        'date': '2023-09-29',
                        'platform': 'TV',
                        'images': {'medium': 'https://example.test/medium.jpg'},
                        'eps': 28,
                    },
                ],
            },
        ),
    )
    provider = BangumiImportProvider(
        base_url='https://api.bgm.tv',
        web_base_url='https://bgm.tv',
        user_agent='ani-tracker/0.1.0 (test)',
        timeout=5,
        session=session,  # type: ignore[arg-type]
    )

    page = provider.search_anime('葬送的芙莉莲', limit=20, offset=0)

    assert session.calls[0]['url'] == 'https://api.bgm.tv/v0/search/subjects'
    assert session.calls[0]['params'] == {'limit': 20, 'offset': 0}
    assert session.calls[0]['json']['filter'] == {'type': [2], 'nsfw': False}
    assert session.calls[0]['json']['sort'] == 'match'
    assert session.calls[0]['headers']['User-Agent'] == 'ani-tracker/0.1.0 (test)'
    assert session.calls[0]['timeout'] == 5
    assert page.results == [
        ImportSearchResult(
            provider='bangumi',
            external_id='493042',
            title='葬送的芙莉莲',
            original_title='葬送のフリーレン',
            summary='summary',
            air_date='2023-09-29',
            platform='TV',
            episode_count=28,
            image_url='https://example.test/medium.jpg',
            url='https://bgm.tv/subject/493042',
            raw_data={
                'id': 493042,
                'name': '葬送のフリーレン',
                'name_cn': '葬送的芙莉莲',
                'summary': 'summary',
                'date': '2023-09-29',
                'platform': 'TV',
                'images': {'medium': 'https://example.test/medium.jpg'},
                'eps': 28,
            },
        ),
    ]


def test_bangumi_provider_tolerates_missing_optional_fields() -> None:
    session = FakeSession(FakeResponse(200, {'data': [{'id': 1, 'name': ''}]}))
    provider = BangumiImportProvider(
        base_url='https://api.bgm.tv',
        web_base_url='https://bgm.tv',
        user_agent='ani-tracker/0.1.0 (test)',
        timeout=5,
        session=session,  # type: ignore[arg-type]
    )

    page = provider.search_anime('x', limit=20, offset=0)

    assert page.results[0] == ImportSearchResult(
        provider='bangumi',
        external_id='1',
        title='Untitled',
        original_title=None,
        summary=None,
        air_date=None,
        platform=None,
        episode_count=None,
        image_url=None,
        url='https://bgm.tv/subject/1',
        raw_data={'id': 1, 'name': ''},
    )


def test_bangumi_date_only_episode_uses_jst_status_boundary() -> None:
    provider = BangumiImportProvider(
        base_url='https://api.bgm.tv',
        web_base_url='https://bgm.tv',
        user_agent='ani-tracker/0.1.0 (test)',
        timeout=5,
        session=FakeSession(),  # type: ignore[arg-type]
    )

    episode = provider._map_episode({'id': 1, 'sort': 1, 'airdate': '2026-07-21'})  # noqa: SLF001

    assert episode is not None
    assert episode.air_at == datetime(2026, 7, 21, tzinfo=UTC)
    assert episode.air_at_has_time is False
    assert episode.status_air_at == datetime(2026, 7, 20, 15, tzinfo=UTC)


def test_bangumi_provider_maps_safe_related_anime_only() -> None:
    session = FakeSession(
        [
            FakeResponse(
                200,
                {
                    'id': 493042,
                    'name': '葬送のフリーレン',
                    'name_cn': '葬送的芙莉莲',
                    'summary': 'summary',
                    'date': '2023-09-29',
                    'platform': 'TV',
                    'images': {'medium': 'https://example.test/current.jpg'},
                    'eps': 28,
                },
            ),
            FakeResponse(200, {'total': 0, 'data': []}),
            FakeResponse(
                200,
                [
                    {
                        'id': 100,
                        'type': 2,
                        'name': 'Frieren 2',
                        'name_cn': '葬送的芙莉莲 第二季',
                        'relation': '续集',
                        'images': {'common': 'https://example.test/s2.jpg'},
                    },
                    {'id': 101, 'type': 2, 'name': 'Frieren Special', 'relation': '番外篇'},
                    {'id': 102, 'type': 1, 'name': 'Frieren Manga', 'relation': '前传'},
                    {'id': 103, 'type': 2, 'name': 'Frieren Reimagined', 'relation': '不同演绎'},
                    {'id': 104, 'type': 2, 'name': 'Frieren 0', 'relation': '前传'},
                ],
            ),
            FakeResponse(200, []),
            FakeResponse(200, []),
        ],
    )
    provider = BangumiImportProvider(
        base_url='https://api.bgm.tv',
        web_base_url='https://bgm.tv',
        user_agent='ani-tracker/0.1.0 (test)',
        timeout=5,
        session=session,  # type: ignore[arg-type]
    )

    detail = provider.get_anime_detail('493042')

    assert session.calls[2]['url'] == 'https://api.bgm.tv/v0/subjects/493042/subjects'
    assert [item.external_id for item in detail.related_anime] == ['100', '104']
    assert detail.related_anime[0].provider == 'bangumi'
    assert detail.related_anime[0].title == '葬送的芙莉莲 第二季'
    assert [(title.language, title.name) for title in detail.related_anime[0].titles] == [
        ('zh', '葬送的芙莉莲 第二季'),
        ('ja', 'Frieren 2'),
    ]
    assert detail.related_anime[0].relation_type == 'same_series_season'
    assert detail.related_anime[0].season_number is None
    assert detail.related_anime[0].air_date is None
    assert detail.related_anime[0].episode_count is None
    assert detail.related_anime[0].url == 'https://bgm.tv/subject/100'
    assert detail.related_anime[0].poster_source_url == 'https://example.test/s2.jpg'


def test_bangumi_provider_chains_safe_related_anime() -> None:
    session = FakeSession(
        [
            FakeResponse(200, {'id': 493042, 'name': 'Current', 'platform': 'TV'}),
            FakeResponse(200, {'total': 0, 'data': []}),
            FakeResponse(
                200,
                [
                    {'id': 100, 'type': 2, 'name': 'Season 2', 'relation': '续集'},
                    {'id': 90, 'type': 2, 'name': 'Season 0', 'relation': '前传'},
                ],
            ),
            FakeResponse(
                200,
                [
                    {'id': 101, 'type': 2, 'name': 'Season 3', 'relation': '续集'},
                    {'id': 493042, 'type': 2, 'name': 'Current', 'relation': '前传'},
                ],
            ),
            FakeResponse(200, [{'id': 80, 'type': 2, 'name': 'Season -1', 'relation': '前传'}]),
            FakeResponse(200, []),
            FakeResponse(200, []),
        ],
    )
    provider = BangumiImportProvider(
        base_url='https://api.bgm.tv',
        web_base_url='https://bgm.tv',
        user_agent='ani-tracker/0.1.0 (test)',
        timeout=5,
        session=session,  # type: ignore[arg-type]
    )

    detail = provider.get_anime_detail('493042')

    assert [item.external_id for item in detail.related_anime] == ['100', '90', '101', '80']
    assert [call['url'] for call in session.calls[2:]] == [
        'https://api.bgm.tv/v0/subjects/493042/subjects',
        'https://api.bgm.tv/v0/subjects/100/subjects',
        'https://api.bgm.tv/v0/subjects/90/subjects',
        'https://api.bgm.tv/v0/subjects/101/subjects',
        'https://api.bgm.tv/v0/subjects/80/subjects',
    ]


def test_bangumi_provider_maps_non_2xx_to_response_error() -> None:
    provider = BangumiImportProvider(
        base_url='https://api.bgm.tv',
        web_base_url='https://bgm.tv',
        user_agent='ani-tracker/0.1.0 (test)',
        timeout=5,
        session=FakeSession(FakeResponse(500, {})),  # type: ignore[arg-type]
    )

    with pytest.raises(ImportProviderResponseError):
        provider.search_anime('x', limit=20, offset=0)


def test_bangumi_provider_maps_timeout_to_unified_error() -> None:
    provider = BangumiImportProvider(
        base_url='https://api.bgm.tv',
        web_base_url='https://bgm.tv',
        user_agent='ani-tracker/0.1.0 (test)',
        timeout=5,
        session=FakeSession(error=requests.Timeout()),  # type: ignore[arg-type]
    )

    with pytest.raises(ImportProviderTimeoutError):
        provider.search_anime('x', limit=20, offset=0)


def test_bangumi_provider_maps_http_client_error_to_unified_error() -> None:
    provider = BangumiImportProvider(
        base_url='https://api.bgm.tv',
        web_base_url='https://bgm.tv',
        user_agent='ani-tracker/0.1.0 (test)',
        timeout=5,
        session=FakeSession(error=requests.RequestException()),  # type: ignore[arg-type]
    )

    with pytest.raises(ImportProviderResponseError):
        provider.search_anime('x', limit=20, offset=0)
