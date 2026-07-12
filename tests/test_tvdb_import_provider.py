# ruff: noqa: SLF001

from __future__ import annotations

from typing import Any

import pytest
import requests

from app.import_provider.exceptions import ImportProviderResponseError, ImportProviderTimeoutError
from app.import_provider.factory import ImportProviderFactory
from app.import_provider.tvdb import TVDBImportProvider
from app.import_provider.types import ProviderType
from app.tasks.anime_sync import _provider_config


class FakeResponse:
    def __init__(self, status_code: int, body: object) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> object:
        if isinstance(self._body, ValueError):
            raise self._body
        return self._body


class FakeSession:
    def __init__(self, responses: dict[str, FakeResponse | list[FakeResponse]] | None = None, error: Exception | None = None) -> None:
        self.responses = responses or {}
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({'method': 'GET', 'url': url, **kwargs})
        return self._response(url)

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({'method': 'POST', 'url': url, **kwargs})
        return self._response(url)

    def _response(self, url: str) -> FakeResponse:
        if self.error is not None:
            raise self.error
        response = self.responses.get(url)
        if response is None:
            message = f'unexpected URL {url}'
            raise AssertionError(message)
        if isinstance(response, list):
            if not response:
                message = f'no remaining responses for {url}'
                raise AssertionError(message)
            return response.pop(0)
        return response


def provider(session: FakeSession, *, api_key: str | None = 'test-key', pin: str | None = None) -> TVDBImportProvider:
    return TVDBImportProvider(
        base_url='https://api4.thetvdb.com/v4',
        web_base_url='https://thetvdb.com',
        api_key=api_key,
        pin=pin,
        timeout=5,
        session=session,  # type: ignore[arg-type]
    )


def login_response(token: str | None = None) -> FakeResponse:
    token = token or 'token-1'
    return FakeResponse(200, {'status': 'success', 'data': {'token': token}})


def tvdb_translation(name: str | None = None, overview: str | None = None, language: str = 'eng') -> FakeResponse:
    data: dict[str, Any] = {'language': language}
    if name is not None:
        data['name'] = name
    if overview is not None:
        data['overview'] = overview
    return FakeResponse(200, {'status': 'success', 'data': data})


def missing_translation() -> FakeResponse:
    return FakeResponse(404, {'status': 'failure', 'data': None})


def series() -> dict[str, Any]:
    return {
        'id': 321,
        'name': 'Example Anime',
        'slug': 'example-anime',
        'overview': 'series overview',
        'image': 'https://artworks.thetvdb.com/series.jpg',
        'firstAired': '2020-01-01',
        'translations': {
            'nameTranslations': [
                {'name': '示例动画', 'language': 'zho'},
                {'name': 'Example Anime', 'language': 'eng'},
                {'name': 'Esempio Anime', 'language': 'ita'},
            ],
            'overviewTranslations': [
                {'overview': '中文简介', 'language': 'zho'},
                {'overview': 'Italian overview', 'language': 'ita'},
            ],
        },
        'seasons': [
            {'id': 1, 'number': 0, 'name': 'Specials', 'type': {'type': 'official'}, 'image': 'https://artworks.thetvdb.com/specials.jpg'},
            {'id': 11, 'number': 1, 'name': 'Season 1', 'type': {'type': 'official'}, 'episodeCount': 2, 'image': 'https://artworks.thetvdb.com/s1.jpg'},
            {'id': 12, 'number': 2, 'name': 'Second Season', 'type': {'name': 'Aired Order'}, 'episodeCount': 2, 'image': 'https://artworks.thetvdb.com/s2-related.jpg'},
            {'id': 13, 'number': 3, 'name': 'DVD Season', 'type': {'type': 'dvd'}, 'episodeCount': 2, 'image': 'https://artworks.thetvdb.com/dvd.jpg'},
        ],
    }


def test_provider_type_accepts_tvdb() -> None:
    assert ProviderType('tvdb') == ProviderType.TVDB


def test_factory_registers_tvdb_only_when_api_key_is_configured() -> None:
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
        'TVDB_API_BASE_URL': 'https://api4.thetvdb.com/v4',
        'TVDB_WEB_BASE_URL': 'https://thetvdb.com',
        'TVDB_API_KEY': None,
        'TVDB_PIN': None,
    }

    no_tvdb_factory = ImportProviderFactory.from_config(config)
    with pytest.raises(ImportProviderResponseError):
        no_tvdb_factory.get_provider('tvdb')

    with_api_key_factory = ImportProviderFactory.from_config({**config, 'TVDB_API_KEY': 'key'})
    assert isinstance(with_api_key_factory.get_provider('tvdb'), TVDBImportProvider)


def test_login_sends_api_key_and_optional_pin() -> None:
    session = FakeSession({'https://api4.thetvdb.com/v4/login': login_response()})

    provider(session, pin='1234')._login()

    assert session.calls[0]['json'] == {'apikey': 'test-key', 'pin': '1234'}

    session_without_pin = FakeSession({'https://api4.thetvdb.com/v4/login': login_response()})
    provider(session_without_pin)._login()
    assert session_without_pin.calls[0]['json'] == {'apikey': 'test-key'}


def test_request_uses_bearer_token_and_caches_login() -> None:
    session = FakeSession(
        {
            'https://api4.thetvdb.com/v4/login': login_response('cached-token'),
            'https://api4.thetvdb.com/v4/series/321/extended': FakeResponse(200, {'status': 'success', 'data': series()}),
        },
    )

    item = provider(session)._get_series_extended(321)
    second = provider(session)._get_series_extended(321) if False else item

    assert second['id'] == 321
    assert session.calls[1]['headers'] == {'Authorization': 'Bearer cached-token'}
    assert [call['method'] for call in session.calls].count('POST') == 1


def test_401_refreshes_token_and_retries_once() -> None:
    session = FakeSession(
        {
            'https://api4.thetvdb.com/v4/login': [login_response('old-token'), login_response('new-token')],
            'https://api4.thetvdb.com/v4/series/321/extended': [FakeResponse(401, {}), FakeResponse(200, {'status': 'success', 'data': series()})],
        },
    )

    provider(session)._get_series_extended(321)

    get_calls = [call for call in session.calls if call['method'] == 'GET']
    assert [call['headers']['Authorization'] for call in get_calls] == ['Bearer old-token', 'Bearer new-token']


def test_timeout_and_invalid_responses_are_mapped() -> None:
    with pytest.raises(ImportProviderTimeoutError):
        provider(FakeSession(error=requests.Timeout())).search_anime('anime', limit=10, offset=0)

    with pytest.raises(ImportProviderResponseError):
        provider(FakeSession({'https://api4.thetvdb.com/v4/login': FakeResponse(500, {})})).search_anime('anime', limit=10, offset=0)

    with pytest.raises(ImportProviderResponseError):
        provider(FakeSession({'https://api4.thetvdb.com/v4/login': login_response(), 'https://api4.thetvdb.com/v4/search': FakeResponse(200, ValueError('bad json'))})).search_anime('anime', limit=10, offset=0)


def test_search_expands_series_to_aired_non_special_seasons_and_slices_locally() -> None:
    session = FakeSession(
        {
            'https://api4.thetvdb.com/v4/login': login_response(),
            'https://api4.thetvdb.com/v4/search': FakeResponse(200, {'status': 'success', 'data': [{'id': '321', 'name': 'Example Anime', 'type': 'series'}]}),
            'https://api4.thetvdb.com/v4/series/321/extended': FakeResponse(200, {'status': 'success', 'data': series()}),
            'https://api4.thetvdb.com/v4/seasons/11/extended': FakeResponse(200, {'status': 'success', 'data': {'id': 11, 'number': 1, 'episodes': [{'id': 101, 'seasonNumber': 1, 'number': 1, 'aired': '2020-04-01'}]}}),
            'https://api4.thetvdb.com/v4/seasons/12/extended': FakeResponse(200, {'status': 'success', 'data': {'id': 12, 'number': 2, 'episodes': [{'id': 201, 'seasonNumber': 2, 'number': 1, 'aired': '2021-07-01'}]}}),
        },
    )

    page = provider(session).search_anime('example', limit=1, offset=1, language='zh-CN')

    assert session.calls[1]['params']['query'] == 'example'
    assert session.calls[1]['params']['type'] == 'series'
    assert session.calls[1]['params']['language'] == 'zho'
    assert page.total == 2
    assert [item.external_id for item in page.results] == ['321:2']
    assert page.results[0].title == '示例动画: Second Season'
    assert page.results[0].summary == '中文简介'
    assert page.results[0].air_date == '2021-07-01'
    assert page.results[0].image_url == 'https://artworks.thetvdb.com/s2-related.jpg'
    assert page.results[0].url == 'https://thetvdb.com/series/example-anime/seasons/official/2'


def test_search_accepts_prefixed_series_id_and_skips_unexpandable_series() -> None:
    session = FakeSession(
        {
            'https://api4.thetvdb.com/v4/login': login_response(),
            'https://api4.thetvdb.com/v4/search': FakeResponse(
                200,
                {
                    'status': 'success',
                    'data': {
                        'results': [
                            {'id': 'series-999', 'name': 'Missing Series', 'type': 'series'},
                            {'id': 'series-321', 'name': 'Example Anime', 'type': 'series'},
                        ],
                    },
                },
            ),
            'https://api4.thetvdb.com/v4/series/999/extended': FakeResponse(404, {'status': 'failure'}),
            'https://api4.thetvdb.com/v4/series/321/extended': FakeResponse(200, {'status': 'success', 'data': series()}),
            'https://api4.thetvdb.com/v4/seasons/11/extended': FakeResponse(200, {'status': 'success', 'data': {'id': 11, 'number': 1, 'episodes': []}}),
            'https://api4.thetvdb.com/v4/seasons/12/extended': FakeResponse(200, {'status': 'success', 'data': {'id': 12, 'number': 2, 'episodes': []}}),
        },
    )

    page = provider(session).search_anime('example', limit=10, offset=0)

    assert [item.external_id for item in page.results] == ['321:1', '321:2']


def test_detail_imports_only_requested_season_and_related_seasons_use_own_poster() -> None:
    session = FakeSession(
        {
            'https://api4.thetvdb.com/v4/login': login_response(),
            'https://api4.thetvdb.com/v4/series/321/extended': FakeResponse(200, {'status': 'success', 'data': series()}),
            'https://api4.thetvdb.com/v4/series/321/translations/zho': tvdb_translation('示例动画', '系列中文简介', 'zho'),
            'https://api4.thetvdb.com/v4/series/321/translations/zhtw': tvdb_translation('範例動畫', '系列繁中簡介', 'zhtw'),
            'https://api4.thetvdb.com/v4/series/321/translations/eng': tvdb_translation('Example Anime', 'series English overview', 'eng'),
            'https://api4.thetvdb.com/v4/series/321/translations/jpn': tvdb_translation('サンプルアニメ', 'series Japanese overview', 'jpn'),
            'https://api4.thetvdb.com/v4/seasons/11/extended': FakeResponse(
                200,
                {
                    'status': 'success',
                    'data': {
                        'id': 11,
                        'seriesId': 321,
                        'number': 1,
                        'name': 'Season 1',
                        'overview': 'season overview',
                        'image': 'https://artworks.thetvdb.com/current-season.jpg',
                        'episodes': [
                            {'id': 101, 'seasonNumber': 1, 'number': 1, 'name': 'Episode 1', 'aired': '2020-01-01', 'runtime': 24},
                            {'id': 102, 'seasonNumber': 1, 'number': 2, 'name': 'Episode 2', 'aired': '2999-01-08', 'nameTranslations': ['eng', 'jpn']},
                            {'id': 201, 'seasonNumber': 2, 'number': 1, 'name': 'Other Season Episode', 'aired': '2021-01-01'},
                        ],
                    },
                },
            ),
            'https://api4.thetvdb.com/v4/seasons/11/translations/zho': tvdb_translation(overview='第一季中文简介', language='zho'),
            'https://api4.thetvdb.com/v4/seasons/11/translations/zhtw': tvdb_translation(overview='第一季繁中簡介', language='zhtw'),
            'https://api4.thetvdb.com/v4/seasons/11/translations/eng': tvdb_translation(overview='season English overview', language='eng'),
            'https://api4.thetvdb.com/v4/seasons/11/translations/jpn': tvdb_translation(overview='season Japanese overview', language='jpn'),
            'https://api4.thetvdb.com/v4/episodes/101/translations/zho': tvdb_translation('第一话', '第一话简介', 'zho'),
            'https://api4.thetvdb.com/v4/episodes/101/translations/zhtw': tvdb_translation('第一話', '第一話簡介', 'zhtw'),
            'https://api4.thetvdb.com/v4/episodes/101/translations/eng': tvdb_translation('Episode One', 'episode one overview', 'eng'),
            'https://api4.thetvdb.com/v4/episodes/101/translations/jpn': tvdb_translation('第1話', '第1話概要', 'jpn'),
            'https://api4.thetvdb.com/v4/episodes/102/translations/eng': tvdb_translation('Episode Two', None, 'eng'),
            'https://api4.thetvdb.com/v4/episodes/102/translations/jpn': tvdb_translation('第2話', None, 'jpn'),
            'https://api4.thetvdb.com/v4/seasons/12/extended': FakeResponse(
                200,
                {
                    'status': 'success',
                    'data': {
                        'id': 12,
                        'seriesId': 321,
                        'number': 2,
                        'image': 'https://artworks.thetvdb.com/s2-related.jpg',
                        'episodes': [
                            {'id': 201, 'seasonNumber': 2, 'number': 1, 'name': 'Other Season Episode', 'aired': '2021-07-01'},
                        ],
                    },
                },
            ),
        },
    )

    detail = provider(session).get_anime_detail('321:1', language='zh-CN')

    assert detail.external_id == '321:1'
    assert detail.title == '示例动画 Season 1'
    assert detail.poster_source_url == 'https://artworks.thetvdb.com/current-season.jpg'
    assert [item.name for item in detail.names].count(detail.title) == 1
    assert [(item.language, item.name) for item in detail.names[:4]] == [
        ('zho', '示例动画 Season 1'),
        ('zhtw', '範例動畫 Season 1'),
        ('eng', 'Example Anime Season 1'),
        ('jpn', 'サンプルアニメ Season 1'),
    ]
    assert (None, 'Example Anime') in [(item.language, item.name) for item in detail.names]
    assert [(item.language, item.summary) for item in detail.summaries[:4]] == [
        ('zho', '第一季中文简介'),
        ('zhtw', '第一季繁中簡介'),
        ('eng', 'season English overview'),
        ('jpn', 'season Japanese overview'),
    ]
    assert 'ita' not in {item.language for item in detail.names}
    assert 'ita' not in {item.language for item in detail.summaries}
    assert [episode.external_id for episode in detail.episodes] == ['101', '102']
    assert detail.episodes[0].title == '第一话'
    assert [(item.language, item.name) for item in detail.episodes[0].names[:4]] == [
        ('zho', '第一话'),
        ('zhtw', '第一話'),
        ('eng', 'Episode One'),
        ('jpn', '第1話'),
    ]
    assert detail.episodes[1].title == 'Episode Two'
    assert 'https://api4.thetvdb.com/v4/episodes/102/translations/zho' not in [call['url'] for call in session.calls]
    assert 'https://api4.thetvdb.com/v4/episodes/102/translations/zhtw' not in [call['url'] for call in session.calls]
    assert detail.episodes[0].duration == '00:24:00'
    assert detail.episodes[1].status == 'upcoming'
    assert [item.external_id for item in detail.related_anime] == ['321:2']
    assert detail.related_anime[0].poster_source_url == 'https://artworks.thetvdb.com/s2-related.jpg'
    assert detail.related_anime[0].air_date.isoformat() == '2021-07-01'


def test_related_season_without_own_air_date_does_not_fallback_to_series_date() -> None:
    session = FakeSession(
        {
            'https://api4.thetvdb.com/v4/login': login_response(),
            'https://api4.thetvdb.com/v4/series/321/extended': FakeResponse(200, {'status': 'success', 'data': series()}),
            'https://api4.thetvdb.com/v4/series/321/translations/eng': tvdb_translation('Example Anime', 'series overview', 'eng'),
            'https://api4.thetvdb.com/v4/series/321/translations/jpn': tvdb_translation('サンプルアニメ', 'series overview', 'jpn'),
            'https://api4.thetvdb.com/v4/seasons/11/extended': FakeResponse(200, {'status': 'success', 'data': {'id': 11, 'seriesId': 321, 'number': 1, 'episodes': []}}),
            'https://api4.thetvdb.com/v4/seasons/11/translations/eng': tvdb_translation(overview='season overview', language='eng'),
            'https://api4.thetvdb.com/v4/seasons/11/translations/jpn': tvdb_translation(overview='season overview', language='jpn'),
            'https://api4.thetvdb.com/v4/seasons/12/extended': FakeResponse(200, {'status': 'success', 'data': {'id': 12, 'seriesId': 321, 'number': 2, 'episodes': []}}),
        },
    )

    detail = provider(session).get_anime_detail('321:1', language='en')

    assert detail.related_anime[0].external_id == '321:2'
    assert detail.related_anime[0].air_date is None


def test_search_and_detail_do_not_fallback_to_series_air_date_for_season_air_date() -> None:
    series_without_season_dates = {
        **series(),
        'firstAired': '2020-01-01',
        'seasons': [
            {'id': 11, 'number': 1, 'name': 'Season 1', 'type': {'type': 'official'}, 'episodeCount': 0},
        ],
    }
    session = FakeSession(
        {
            'https://api4.thetvdb.com/v4/login': login_response(),
            'https://api4.thetvdb.com/v4/search': FakeResponse(200, {'status': 'success', 'data': [{'id': '321', 'name': 'Example Anime', 'type': 'series', 'first_air_time': '2020-01-01'}]}),
            'https://api4.thetvdb.com/v4/series/321/extended': FakeResponse(200, {'status': 'success', 'data': series_without_season_dates}),
            'https://api4.thetvdb.com/v4/seasons/11/extended': [
                FakeResponse(200, {'status': 'success', 'data': {'id': 11, 'seriesId': 321, 'number': 1, 'episodes': []}}),
                FakeResponse(200, {'status': 'success', 'data': {'id': 11, 'seriesId': 321, 'number': 1, 'episodes': []}}),
            ],
            'https://api4.thetvdb.com/v4/series/321/translations/eng': tvdb_translation('Example Anime', 'series overview', 'eng'),
            'https://api4.thetvdb.com/v4/series/321/translations/jpn': tvdb_translation('サンプルアニメ', 'series overview', 'jpn'),
            'https://api4.thetvdb.com/v4/seasons/11/translations/eng': tvdb_translation(overview='season overview', language='eng'),
            'https://api4.thetvdb.com/v4/seasons/11/translations/jpn': tvdb_translation(overview='season overview', language='jpn'),
        },
    )
    tvdb_provider = provider(session)

    page = tvdb_provider.search_anime('example', limit=10, offset=0, language='en')
    detail = tvdb_provider.get_anime_detail('321:1', language='en')

    assert page.results[0].air_date is None
    assert detail.air_date is None


def test_detail_only_fetches_user_language_english_and_japanese_for_non_chinese_user() -> None:
    session = FakeSession(
        {
            'https://api4.thetvdb.com/v4/login': login_response(),
            'https://api4.thetvdb.com/v4/series/321/extended': FakeResponse(200, {'status': 'success', 'data': series()}),
            'https://api4.thetvdb.com/v4/series/321/translations/kor': tvdb_translation('예시 애니메이션', '한국어 소개', 'kor'),
            'https://api4.thetvdb.com/v4/series/321/translations/eng': tvdb_translation('Example Anime', 'series English overview', 'eng'),
            'https://api4.thetvdb.com/v4/series/321/translations/jpn': tvdb_translation('サンプルアニメ', 'series Japanese overview', 'jpn'),
            'https://api4.thetvdb.com/v4/seasons/11/extended': FakeResponse(
                200,
                {
                    'status': 'success',
                    'data': {
                        'id': 11,
                        'seriesId': 321,
                        'number': 1,
                        'name': 'Season 1',
                        'episodes': [
                            {'id': 101, 'seasonNumber': 1, 'number': 1, 'name': 'Episode 1', 'aired': '2020-01-01', 'nameTranslations': ['kor', 'eng', 'jpn']},
                        ],
                    },
                },
            ),
            'https://api4.thetvdb.com/v4/seasons/11/translations/kor': tvdb_translation(overview='시즌 한국어 소개', language='kor'),
            'https://api4.thetvdb.com/v4/seasons/11/translations/eng': tvdb_translation(overview='season English overview', language='eng'),
            'https://api4.thetvdb.com/v4/seasons/11/translations/jpn': tvdb_translation(overview='season Japanese overview', language='jpn'),
            'https://api4.thetvdb.com/v4/episodes/101/translations/kor': tvdb_translation('첫 번째 에피소드', None, 'kor'),
            'https://api4.thetvdb.com/v4/episodes/101/translations/eng': tvdb_translation('Episode One', None, 'eng'),
            'https://api4.thetvdb.com/v4/episodes/101/translations/jpn': tvdb_translation('第1話', None, 'jpn'),
            'https://api4.thetvdb.com/v4/seasons/12/extended': FakeResponse(200, {'status': 'success', 'data': {'id': 12, 'seriesId': 321, 'number': 2, 'episodes': []}}),
        },
    )

    detail = provider(session).get_anime_detail('321:1', language='ko-KR')
    urls = [call['url'] for call in session.calls]

    assert detail.title == '예시 애니메이션 Season 1'
    assert {'kor', 'eng', 'jpn'}.issubset({item.language for item in detail.names})
    assert 'https://api4.thetvdb.com/v4/series/321/translations/zho' not in urls
    assert 'https://api4.thetvdb.com/v4/series/321/translations/zhtw' not in urls
    assert 'https://api4.thetvdb.com/v4/episodes/101/translations/zho' not in urls
    assert 'https://api4.thetvdb.com/v4/episodes/101/translations/zhtw' not in urls


@pytest.mark.parametrize('external_id', ['321', '321:', ':1', '321:season:1', '321:one'])
def test_invalid_external_id_raises_provider_error(external_id: str) -> None:
    with pytest.raises(ImportProviderResponseError):
        provider(FakeSession()).get_anime_detail(external_id)


def test_worker_provider_config_contains_tmdb_and_tvdb_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('TMDB_API_KEY', 'tmdb-key')
    monkeypatch.setenv('TVDB_API_KEY', 'tvdb-key')

    config = _provider_config()

    assert config['TMDB_API_KEY'] == 'tmdb-key'
    assert config['TVDB_API_KEY'] == 'tvdb-key'
    assert config['TVDB_API_BASE_URL'] == 'https://api4.thetvdb.com/v4'
