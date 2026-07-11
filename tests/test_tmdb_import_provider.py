from __future__ import annotations

from typing import Any

import pytest
import requests

from app.import_provider.exceptions import ImportProviderResponseError, ImportProviderTimeoutError
from app.import_provider.factory import ImportProviderFactory
from app.import_provider.tmdb import TmdbImportProvider
from app.import_provider.types import ProviderType

DEFAULT_API_KEY = 'test-api-key'
DEFAULT_ACCESS_TOKEN = 'test-access-token'


class FakeResponse:
    def __init__(self, status_code: int, body: object) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> object:
        if isinstance(self._body, ValueError):
            raise self._body
        return self._body


class FakeSession:
    def __init__(self, responses: dict[str, FakeResponse] | None = None, error: Exception | None = None) -> None:
        self.responses = responses or {}
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({'url': url, **kwargs})
        if self.error is not None:
            raise self.error
        response = self.responses.get(url)
        if response is None:
            message = f'unexpected URL {url}'
            raise AssertionError(message)
        return response


def provider(
    session: FakeSession,
    *,
    access_token: str | None = None,
    api_key: str | None = DEFAULT_API_KEY,
) -> TmdbImportProvider:
    return TmdbImportProvider(
        base_url='https://api.themoviedb.org/3',
        web_base_url='https://www.themoviedb.org',
        image_base_url='https://image.tmdb.org/t/p',
        poster_size='w500',
        access_token=access_token,
        api_key=api_key,
        include_adult=False,
        timeout=5,
        session=session,  # type: ignore[arg-type]
    )


def tv_series() -> dict[str, Any]:
    return {
        'id': 1399,
        'name': 'Game of Thrones',
        'original_name': 'Game of Thrones',
        'overview': 'series overview',
        'first_air_date': '2011-04-17',
        'poster_path': '/series.jpg',
        'episode_run_time': [55],
        'seasons': [
            {'season_number': 0, 'name': 'Specials', 'episode_count': 3, 'air_date': '2010-01-01'},
            {'season_number': 1, 'name': 'Season 1', 'episode_count': 10, 'air_date': '2011-04-17'},
            {'season_number': 2, 'name': 'Season 2', 'episode_count': 10, 'air_date': '2012-04-01', 'poster_path': '/s2.jpg'},
        ],
    }


def test_provider_type_accepts_tmdb() -> None:
    assert ProviderType('tmdb') == ProviderType.TMDB


def test_factory_registers_tmdb_only_when_api_key_is_configured() -> None:
    config = {
        'BANGUMI_API_BASE_URL': 'https://api.bgm.tv',
        'BANGUMI_WEB_BASE_URL': 'https://bgm.tv',
        'BANGUMI_USER_AGENT': 'test',
        'IMPORT_PROVIDER_TIMEOUT': 5,
        'TMDB_API_BASE_URL': 'https://api.themoviedb.org/3',
        'TMDB_WEB_BASE_URL': 'https://www.themoviedb.org',
        'TMDB_IMAGE_BASE_URL': 'https://image.tmdb.org/t/p',
        'TMDB_POSTER_SIZE': 'w500',
        'TMDB_ACCESS_TOKEN': None,
        'TMDB_API_KEY': None,
        'TMDB_INCLUDE_ADULT': False,
    }

    no_tmdb_factory = ImportProviderFactory.from_config(config)
    with pytest.raises(ImportProviderResponseError):
        no_tmdb_factory.get_provider('tmdb')

    with_api_key_factory = ImportProviderFactory.from_config({**config, 'TMDB_API_KEY': 'key'})
    assert isinstance(with_api_key_factory.get_provider('tmdb'), TmdbImportProvider)

    with_token_factory = ImportProviderFactory.from_config({**config, 'TMDB_ACCESS_TOKEN': 'token'})
    assert isinstance(with_token_factory.get_provider('tmdb'), TmdbImportProvider)


def test_search_maps_movie_and_expands_tv_seasons() -> None:
    session = FakeSession(
        {
            'https://api.themoviedb.org/3/search/multi': FakeResponse(
                200,
                {
                    'total_results': 2,
                    'total_pages': 1,
                    'results': [
                        {'media_type': 'person', 'id': 1, 'name': 'Someone'},
                        {'media_type': 'movie', 'id': 11, 'title': 'Star Wars', 'original_title': 'Star Wars', 'overview': 'movie overview', 'release_date': '1977-05-25', 'poster_path': '/movie.jpg'},
                        {'media_type': 'tv', 'id': 1399, 'name': 'Game of Thrones'},
                    ],
                },
            ),
            'https://api.themoviedb.org/3/tv/1399': FakeResponse(200, tv_series()),
        },
    )

    page = provider(session).search_anime('game', limit=10, offset=0)

    assert session.calls[0]['params']['query'] == 'game'
    assert session.calls[0]['params']['include_adult'] == 'false'
    assert session.calls[0]['params']['api_key'] == DEFAULT_API_KEY
    assert [item.external_id for item in page.results] == ['movie:11', 'tv:1399:season:1', 'tv:1399:season:2']
    assert page.results[0].episode_count == 1
    assert page.results[1].platform == 'tv'
    assert page.results[1].image_url == 'https://image.tmdb.org/t/p/w500/series.jpg'
    assert page.results[2].image_url == 'https://image.tmdb.org/t/p/w500/s2.jpg'


def test_search_uses_request_language() -> None:
    session = FakeSession(
        {
            'https://api.themoviedb.org/3/search/multi': FakeResponse(200, {'total_results': 0, 'total_pages': 1, 'results': []}),
        },
    )

    provider(session).search_anime('matrix', limit=10, offset=0, language='en-US')

    assert session.calls[0]['params']['language'] == 'en-US'


def test_access_token_is_used_before_api_key() -> None:
    session = FakeSession(
        {
            'https://api.themoviedb.org/3/search/multi': FakeResponse(200, {'total_results': 0, 'total_pages': 1, 'results': []}),
        },
    )

    provider(session, access_token=DEFAULT_ACCESS_TOKEN, api_key=DEFAULT_API_KEY).search_anime('matrix', limit=10, offset=0)

    assert session.calls[0]['headers'] == {'Authorization': f'Bearer {DEFAULT_ACCESS_TOKEN}'}
    assert 'api_key' not in session.calls[0]['params']


def test_movie_detail_generates_single_episode() -> None:
    session = FakeSession(
        {
            'https://api.themoviedb.org/3/movie/11': FakeResponse(
                200,
                {'id': 11, 'title': 'Star Wars', 'original_title': 'Star Wars', 'overview': 'movie overview', 'release_date': '1977-05-25', 'runtime': 121, 'poster_path': '/movie.jpg'},
            ),
        },
    )

    detail = provider(session).get_anime_detail('movie:11', language='en-US')

    assert detail.external_id == 'movie:11'
    assert detail.anime_type == 'movie'
    assert detail.total_episodes == 1
    assert detail.poster_source_url == 'https://image.tmdb.org/t/p/w500/movie.jpg'
    assert detail.episodes[0].episode_number == 1
    assert detail.episodes[0].duration == '02:01:00'
    assert detail.episodes[0].status == 'aired'
    assert detail.summaries[0].language == 'en-US'
    assert detail.names[0].language == 'en-US'
    assert [call['params']['language'] for call in session.calls] == ['en-US', 'zh-CN', 'zh-TW', 'ja-JP']


def test_movie_detail_merges_required_languages() -> None:
    session = FakeSession(
        {
            'https://api.themoviedb.org/3/movie/11': FakeResponse(
                200,
                {'id': 11, 'title': 'Star Wars', 'original_title': 'Star Wars', 'overview': 'localized overview', 'release_date': '1977-05-25', 'runtime': 121},
            ),
        },
    )

    detail = provider(session).get_anime_detail('movie:11', language='ja-JP')

    assert [call['params']['language'] for call in session.calls] == ['ja-JP', 'en-US', 'zh-CN', 'zh-TW']
    assert [summary.language for summary in detail.summaries] == ['ja-JP', 'en-US', 'zh-CN', 'zh-TW']


def test_tv_detail_imports_only_requested_season_and_related_seasons() -> None:
    session = FakeSession(
        {
            'https://api.themoviedb.org/3/tv/1399': FakeResponse(200, tv_series()),
            'https://api.themoviedb.org/3/tv/1399/season/2': FakeResponse(
                200,
                {
                    'id': 3627,
                    'season_number': 2,
                    'name': 'Season 2',
                    'overview': 'season overview',
                    'air_date': '2012-04-01',
                    'poster_path': '/s2.jpg',
                    'episodes': [
                        {'id': 63056, 'episode_number': 1, 'name': 'The North Remembers', 'air_date': '2012-04-01'},
                        {'id': 63057, 'episode_number': 2, 'name': 'The Night Lands', 'air_date': '2999-04-08', 'runtime': 50},
                    ],
                },
            ),
        },
    )

    detail = provider(session).get_anime_detail('tv:1399:season:2')

    assert detail.external_id == 'tv:1399:season:2'
    assert detail.anime_type == 'tv'
    assert detail.total_episodes == 10
    assert detail.episodes[0].external_id == 'tv:1399:season:2:episode:1'
    assert detail.episodes[0].episode_number == 1
    assert detail.episodes[0].duration == '00:55:00'
    assert detail.episodes[1].status == 'upcoming'
    assert [item.external_id for item in detail.related_anime] == ['tv:1399:season:1']
    assert detail.related_anime[0].poster_source_url == 'https://image.tmdb.org/t/p/w500/series.jpg'
    assert [call['params']['language'] for call in session.calls] == ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'en-US', 'zh-CN', 'zh-TW', 'ja-JP']


@pytest.mark.parametrize('external_id', ['1399', 'person:1', 'movie:', 'tv:1399', 'tv:1399:season:'])
def test_invalid_external_id_raises_provider_error(external_id: str) -> None:
    with pytest.raises(ImportProviderResponseError):
        provider(FakeSession()).get_anime_detail(external_id)


def test_missing_credentials_raise_provider_error() -> None:
    with pytest.raises(ImportProviderResponseError):
        provider(FakeSession(), access_token=None, api_key=None).search_anime('matrix', limit=10, offset=0)


def test_timeout_and_invalid_responses_are_mapped() -> None:
    with pytest.raises(ImportProviderTimeoutError):
        provider(FakeSession(error=requests.Timeout())).search_anime('matrix', limit=10, offset=0)

    with pytest.raises(ImportProviderResponseError):
        provider(FakeSession({'https://api.themoviedb.org/3/search/multi': FakeResponse(500, {})})).search_anime('matrix', limit=10, offset=0)

    with pytest.raises(ImportProviderResponseError):
        provider(FakeSession({'https://api.themoviedb.org/3/search/multi': FakeResponse(200, ValueError('bad json'))})).search_anime('matrix', limit=10, offset=0)
