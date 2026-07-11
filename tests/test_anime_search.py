from __future__ import annotations

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
def app(tmp_path) -> Flask:  # type: ignore[no-untyped-def]
    return create_app(
        {
            'DATABASE_URL': f"sqlite:///{tmp_path / 'test.db'}",
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

    def search_anime(self, keyword: str, *, limit: int, offset: int) -> ImportSearchPage:
        self.calls.append((keyword, limit, offset))
        if self.error is not None:
            raise self.error
        return self.page

    def get_anime_detail(self, _external_id: str) -> ImportAnimeDetail:
        raise NotImplementedError


class FakeResponse:
    def __init__(self, status_code: int, body: object) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> object:
        if isinstance(self._body, ValueError):
            raise self._body
        return self._body


class FakeSession:
    def __init__(self, response: FakeResponse | None = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({'url': url, **kwargs})
        if self.error is not None:
            raise self.error
        assert self.response is not None
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
