from __future__ import annotations

import logging
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import requests

from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import (
    ImportProviderNotFoundError,
    ImportProviderResponseError,
    ImportProviderTimeoutError,
)
from app.import_provider.tvdb.utils import (
    build_external_id,
    coerce_int,
    first_non_empty,
    is_aired_order_season,
    map_status,
    normalize_image_url,
    parse_air_at,
    parse_date,
    parse_external_id,
    parse_status_air_at,
    runtime_to_duration,
    tvdb_language,
)
from app.import_provider.types import (
    ImportAnimeDetail,
    ImportAnimeName,
    ImportAnimeSummary,
    ImportEpisodeInfo,
    ImportEpisodeName,
    ImportProviderUpdate,
    ImportProviderUpdateBatch,
    ImportRelatedAnime,
    ImportSearchPage,
    ImportSearchResult,
    ProviderUpdateMethod,
)
from app.languages import SUPPORTED_LANGUAGE_PREFERENCES

logger = logging.getLogger(__name__)

_COUNTRY_ORIGINAL_LANGUAGES = {
    'chn': 'zho',
    'china': 'zho',
    'gbr': 'eng',
    'japan': 'jpn',
    'jpn': 'jpn',
    'kor': 'kor',
    'south korea': 'kor',
    'taiwan': 'zhtw',
    'twn': 'zhtw',
    'united kingdom': 'eng',
    'united states': 'eng',
    'usa': 'eng',
}

_TVDB_PROJECT_LANGUAGES = {
    'en': 'eng',
    'zh-CN': 'zho',
}

type QueryParam = str | bytes | int | float | Iterable[str | bytes | int | float] | None


class TVDBImportProvider(ImportProvider):
    name = 'tvdb'
    update_streams = ('episodes', 'series')
    _search_series_limit = 20
    _required_detail_languages = tuple(
        dict.fromkeys(
            [
                *(
                    _TVDB_PROJECT_LANGUAGES[language]
                    for language in SUPPORTED_LANGUAGE_PREFERENCES
                    if language in _TVDB_PROJECT_LANGUAGES
                ),
                'jpn',
            ],
        ),
    )
    _chinese_detail_languages = ('zho', 'zhtw')
    _search_series_workers = 4
    _episode_translation_workers = 8
    _detail_fetch_workers = 3

    def __init__(
        self,
        *,
        base_url: str,
        web_base_url: str,
        api_key: str | None,
        pin: str | None,
        timeout: float,
        session: requests.Session | None = None,
    ) -> None:
        self._base_url = base_url.rstrip('/')
        self._web_base_url = web_base_url.rstrip('/')
        self._api_key = api_key.strip() if api_key else None
        self._pin = pin.strip() if pin else None
        self._timeout = timeout
        self._session = session or requests.Session()
        self._token: str | None = None

    def search_anime(self, keyword: str, *, limit: int, offset: int, language: str | None = None) -> ImportSearchPage:
        request_language = tvdb_language(language)
        request_params: dict[str, QueryParam] = {'query': keyword, 'type': 'series', 'limit': self._search_series_limit}
        if request_language is not None:
            request_params['language'] = request_language
        results: list[ImportSearchResult] = []
        target_count = offset + limit
        has_more = False
        source_offset = 0
        while True:
            page_body = self._request_json('/search', params={**request_params, 'offset': source_offset})
            search_results = self._response_data_list(page_body, 'TVDB search response is invalid')
            page_has_next = self._has_next_page(page_body)
            expanded_items = self._expand_search_series(search_results)
            for item_index, item_and_series in enumerate(expanded_items):
                if len(results) >= target_count:
                    has_more = True
                    break
                item, series = item_and_series
                season = self._search_season(series)
                if season is None:
                    continue
                results.append(self._map_season_search(item, series, season, None, language=request_language))
                if len(results) >= target_count and item_index < len(search_results) - 1:
                    has_more = True
                    break
                if len(results) >= target_count:
                    break
            if len(results) >= target_count:
                has_more = has_more or page_has_next
                break
            if not page_has_next:
                break
            source_offset += self._search_series_limit
        page_results = results[offset:offset + limit]
        total = offset + len(page_results) + 1 if has_more else len(results)
        return ImportSearchPage(total=total, limit=limit, offset=offset, results=page_results)

    def get_series_seasons(self, external_id: str, *, language: str | None = None) -> list[ImportSearchResult]:
        series_id, _season_number = parse_external_id(external_id)
        request_language = tvdb_language(language)
        series = self._get_series_extended(series_id)
        search_result = {'id': series_id, 'name': series.get('name')}
        return [
            self._map_season_search(search_result, series, season, None, language=request_language, include_season_in_title=True)
            for season in self._importable_seasons(series, include_specials=True)
        ]

    def get_anime_detail(self, external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
        series_id, season_number = parse_external_id(external_id)
        series = self._get_series_extended(series_id)
        season_summary = self._find_season(series, season_number)
        season_id = season_summary.get('id')
        if not isinstance(season_id, int | str):
            message = 'TVDB season id is missing'
            raise ImportProviderResponseError(message)
        season = self._get_season_extended(season_id)
        if coerce_int(season.get('number'), season_number) != season_number:
            season = {**season, 'number': season_number}
        request_language = tvdb_language(language)
        detail_languages = self._detail_languages(language)
        episode_items = self._episode_items(season, season_number)
        with ThreadPoolExecutor(max_workers=self._detail_fetch_workers) as executor:
            series_translations_future = executor.submit(self._fetch_translations, f'/series/{series_id}/translations', detail_languages)
            season_translations_future = executor.submit(self._fetch_translations, f'/seasons/{season_id}/translations', detail_languages)
            episode_translations_future = executor.submit(self._fetch_episode_translations_page, episode_items, detail_languages)
            series_translations = series_translations_future.result()
            season_translations = season_translations_future.result()
            episode_translations = episode_translations_future.result()
        episodes = [
            self._map_episode(
                series_id,
                episode,
                translations=episode_translations.get(self._episode_key(episode), {}),
                language=request_language,
                airs_time=series.get('airsTime'),
                country=first_non_empty(
                    series.get('originalCountry'),
                    series.get('country'),
                    self._company_country(series.get('originalNetwork')),
                    self._company_country(series.get('latestNetwork')),
                ),
            )
            for episode in episode_items
        ]
        title = self._season_title(series, season_summary, language=request_language, translations=series_translations)
        return ImportAnimeDetail(
            provider=self.name,
            external_id=build_external_id(series_id, season_number),
            title=title,
            original_title=first_non_empty(series.get('name')),
            summaries=self._summaries(series, season, allowed_languages=detail_languages, series_translations=series_translations, season_translations=season_translations),
            poster_source_url=self._poster_url(season) or self._poster_url(season_summary) or self._poster_url(series),
            anime_type=self._anime_type(season_number),
            total_episodes=len(episodes),
            url=self._season_url(series, season_number),
            names=self._names(series, season_summary, season, language=request_language, title=title, allowed_languages=detail_languages, series_translations=series_translations, season_translations=season_translations),
            episodes=episodes,
            raw_data={'series': series, 'season': season, 'episodes': season.get('episodes')},
            air_date=self._season_air_date(season, episodes),
            related_anime=self._related_seasons(
                series,
                season_number,
                language=request_language,
                languages=detail_languages,
                series_translations=series_translations,
            ),
        )

    def get_updates(self, *, since: int, stream: str, page: int = 0, max_pages: int = 100) -> ImportProviderUpdateBatch:
        updates: list[ImportProviderUpdate] = []
        seen: set[tuple[str, int, int, ProviderUpdateMethod]] = set()
        pages_read = 0
        while pages_read < max_pages:
            body = self._request_json('/updates', params={'since': since, 'type': stream, 'page': page})
            for item in self._response_data_list(body, 'TVDB updates response is invalid'):
                if not isinstance(item, dict):
                    continue
                record_id = coerce_int(item.get('recordId'))
                timestamp = coerce_int(item.get('timeStamp'))
                method_value = coerce_int(item.get('methodInt'))
                item_type = item.get('entityType')
                if record_id is None or timestamp is None or method_value is None or not isinstance(item_type, str):
                    continue
                try:
                    method = ProviderUpdateMethod(method_value)
                except ValueError:
                    continue
                key = (item_type, record_id, timestamp, method)
                if key in seen:
                    continue
                seen.add(key)
                updates.append(
                    ImportProviderUpdate(
                        entity_type=item_type,
                        record_id=record_id,
                        timestamp=timestamp,
                        method=method,
                        parent_id=coerce_int(item.get('seriesId')),
                        raw_data=item,
                    ),
                )
            links = body.get('links') if isinstance(body, dict) else None
            if not isinstance(links, dict) or not links.get('next'):
                return ImportProviderUpdateBatch(updates=updates)
            page += 1
            pages_read += 1
        return ImportProviderUpdateBatch(updates=updates, next_page=page)

    def get_episode_base(self, episode_id: int) -> dict[str, Any] | None:
        try:
            body = self._request_json(f'/episodes/{episode_id}', suppress_not_found_log=True)
        except ImportProviderNotFoundError:
            return None
        return self._response_data_dict(body, 'TVDB episode response is invalid')

    def _login(self) -> str:
        if self._api_key is None:
            message = 'TVDB credentials are not configured'
            raise ImportProviderResponseError(message)
        payload: dict[str, str] = {'apikey': self._api_key}
        if self._pin is not None:
            payload['pin'] = self._pin
        try:
            response = self._session.post(f'{self._base_url}/login', json=payload, timeout=self._timeout)
        except requests.Timeout as exc:
            logger.warning('TVDB login timed out', exc_info=exc)
            message = 'TVDB request timed out'
            raise ImportProviderTimeoutError(message) from exc
        except requests.RequestException as exc:
            logger.warning('TVDB login failed', exc_info=exc)
            message = 'TVDB request failed'
            raise ImportProviderResponseError(message) from exc
        if not 200 <= response.status_code < 300:
            logger.warning('TVDB login returned status code %s', response.status_code)
            message = 'TVDB authentication failed'
            raise ImportProviderResponseError(message)
        try:
            body = response.json()
        except ValueError as exc:
            logger.warning('TVDB login returned invalid JSON', exc_info=exc)
            message = 'TVDB returned invalid JSON'
            raise ImportProviderResponseError(message) from exc
        if not isinstance(body, dict) or not isinstance(body.get('data'), dict) or not isinstance(body['data'].get('token'), str):
            message = 'TVDB authentication response is invalid'
            raise ImportProviderResponseError(message)
        self._token = body['data']['token']
        return self._token

    def _request_json(
        self,
        path: str,
        *,
        params: dict[str, QueryParam] | None = None,
        retry_auth: bool = True,
        suppress_not_found_log: bool = False,
    ) -> object:
        token = self._token or self._login()
        headers = {'Authorization': f'Bearer {token}'}
        try:
            response = self._session.get(f'{self._base_url}{path}', params=params or {}, headers=headers, timeout=self._timeout)
        except requests.Timeout as exc:
            logger.warning('TVDB request timed out for %s', path, exc_info=exc)
            message = 'TVDB request timed out'
            raise ImportProviderTimeoutError(message) from exc
        except requests.RequestException as exc:
            logger.warning('TVDB request failed for %s', path, exc_info=exc)
            message = 'TVDB request failed'
            raise ImportProviderResponseError(message) from exc
        if response.status_code == 401 and retry_auth:
            logger.warning('TVDB returned 401 for %s; refreshing token', path)
            self._token = None
            return self._request_json(path, params=params, retry_auth=False, suppress_not_found_log=suppress_not_found_log)
        if not 200 <= response.status_code < 300:
            if response.status_code != 404 or not suppress_not_found_log:
                logger.warning('TVDB returned status code %s for %s', response.status_code, path)
            message = 'TVDB returned an error response'
            if response.status_code == 404:
                raise ImportProviderNotFoundError(message)
            raise ImportProviderResponseError(message)
        try:
            body = response.json()
        except ValueError as exc:
            logger.warning('TVDB returned invalid JSON for %s', path, exc_info=exc)
            message = 'TVDB returned invalid JSON'
            raise ImportProviderResponseError(message) from exc
        if not isinstance(body, dict) or 'data' not in body:
            message = 'TVDB response is invalid'
            raise ImportProviderResponseError(message)
        return body

    def _get_series_extended(self, series_id: int | str) -> dict[str, Any]:
        body = self._request_json(f'/series/{series_id}/extended', params={'meta': 'translations'})
        data = self._response_data_dict(body, 'TVDB series response is invalid')
        if 'id' not in data:
            data = {**data, 'id': series_id}
        return data

    def _get_season_extended(self, season_id: int | str) -> dict[str, Any]:
        body = self._request_json(f'/seasons/{season_id}/extended')
        return self._response_data_dict(body, 'TVDB season response is invalid')

    def _expand_search_series(self, search_results: list[Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
        items: list[tuple[dict[str, Any], int | str]] = []
        for item in search_results:
            if not isinstance(item, dict):
                continue
            series_id = self._series_id(item)
            if series_id is not None:
                items.append((item, series_id))
        if not items:
            return []

        self._token = self._token or self._login()
        workers = min(self._search_series_workers, len(items))
        if workers <= 1:
            expanded: list[tuple[dict[str, Any], dict[str, Any]]] = []
            for item, series_id in items:
                try:
                    expanded.append((item, self._get_series_extended(series_id)))
                except ImportProviderResponseError:
                    logger.warning('Skipping TVDB search result because series %s could not be expanded', series_id)
            return expanded

        expanded = []
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [(item, series_id, executor.submit(self._get_series_extended, series_id)) for item, series_id in items]
            for item, series_id, future in futures:
                try:
                    expanded.append((item, future.result()))
                except ImportProviderResponseError:
                    logger.warning('Skipping TVDB search result because series %s could not be expanded', series_id)
        return expanded

    def _fetch_translations(self, path: str, languages: list[str]) -> dict[str, dict[str, Any]]:
        translations: dict[str, dict[str, Any]] = {}
        for language in languages:
            try:
                body = self._request_json(f'{path}/{language}', suppress_not_found_log=True)
            except ImportProviderResponseError:
                continue
            data = self._response_data_dict(body, 'TVDB translation response is invalid')
            translations[language] = data
        return translations

    def _fetch_episode_translations(self, episode: dict[str, Any], languages: list[str]) -> dict[str, dict[str, Any]]:
        episode_id = episode.get('id')
        if not isinstance(episode_id, int | str):
            return {}
        available_languages = self._available_translation_languages(episode)
        request_languages = [language for language in languages if available_languages is None or language in available_languages]
        if not request_languages:
            return {}
        return self._fetch_translations(f'/episodes/{episode_id}/translations', request_languages)

    def _fetch_episode_translations_page(
        self,
        episodes: list[dict[str, Any]],
        languages: list[str],
    ) -> dict[str, dict[str, dict[str, Any]]]:
        if not episodes:
            return {}
        workers = min(self._episode_translation_workers, len(episodes))
        if workers <= 1:
            return {self._episode_key(episode): self._fetch_episode_translations(episode, languages) for episode in episodes}
        translations: dict[str, dict[str, dict[str, Any]]] = {}
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(self._fetch_episode_translations, episode, languages): self._episode_key(episode) for episode in episodes}
            for future, key in futures.items():
                translations[key] = future.result()
        return translations

    def _episode_key(self, episode: dict[str, Any]) -> str:
        episode_id = episode.get('id')
        if isinstance(episode_id, int | str):
            return str(episode_id)
        return str(coerce_int(episode.get('number'), 0) or 0)

    def _available_translation_languages(self, item: dict[str, Any]) -> set[str] | None:
        languages: set[str] = set()
        for key in ('nameTranslations', 'overviewTranslations'):
            values = item.get(key)
            if isinstance(values, list):
                for value in values:
                    if isinstance(value, str):
                        languages.update(part.strip() for part in value.split(',') if part.strip())
                    elif isinstance(value, dict):
                        language = first_non_empty(value.get('language'), value.get('languageCode'), value.get('iso_639_3'))
                        if language is not None:
                            languages.add(language)
        return languages or None

    def _response_data_dict(self, body: object, message: str) -> dict[str, Any]:
        if not isinstance(body, dict) or not isinstance(body.get('data'), dict):
            raise ImportProviderResponseError(message)
        return body['data']

    def _response_data_list(self, body: object, message: str) -> list[Any]:
        if not isinstance(body, dict):
            raise ImportProviderResponseError(message)
        data = body.get('data')
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get('results'), list):
            return data['results']
        raise ImportProviderResponseError(message)

    def _has_next_page(self, body: object) -> bool:
        if not isinstance(body, dict) or not isinstance(body.get('links'), dict):
            return False
        return body['links'].get('next') is not None

    def _series_id(self, item: dict[str, Any]) -> int | str | None:
        value = item.get('tvdb_id') or item.get('id')
        if isinstance(value, int):
            return value
        if not isinstance(value, str) or not value.strip():
            return None
        text = value.strip()
        if text.isdigit():
            return text
        prefix = 'series-'
        if text.lower().startswith(prefix) and text[len(prefix):].isdigit():
            return text[len(prefix):]
        return None

    def _aired_seasons(self, series: dict[str, Any]) -> list[dict[str, Any]]:
        return self._importable_seasons(series, include_specials=False)

    def _importable_seasons(self, series: dict[str, Any], *, include_specials: bool) -> list[dict[str, Any]]:
        seasons = series.get('seasons')
        if not isinstance(seasons, list):
            return []
        return [
            season
            for season in seasons
            if isinstance(season, dict)
            and is_aired_order_season(season)
            and coerce_int(season.get('number')) is not None
            and (include_specials or coerce_int(season.get('number')) != 0)
        ]

    def _find_season(self, series: dict[str, Any], season_number: int) -> dict[str, Any]:
        for season in self._importable_seasons(series, include_specials=season_number == 0):
            if coerce_int(season.get('number')) == season_number:
                return season
        message = 'TVDB season does not exist'
        raise ImportProviderResponseError(message)

    def _search_season(self, series: dict[str, Any]) -> dict[str, Any] | None:
        for season in self._importable_seasons(series, include_specials=False):
            if coerce_int(season.get('number')) == 1:
                return season
        return None

    def _season_detail_for_summary(self, season: dict[str, Any]) -> dict[str, Any] | None:
        season_id = season.get('id')
        if not isinstance(season_id, int | str):
            return None
        try:
            return self._get_season_extended(season_id)
        except ImportProviderResponseError:
            logger.warning('TVDB season %s could not be expanded', season_id)
            return None

    def _map_season_search(
        self,
        search_result: dict[str, Any],
        series: dict[str, Any],
        season: dict[str, Any],
        season_detail: dict[str, Any] | None,
        *,
        language: str | None,
        include_season_in_title: bool = False,
    ) -> ImportSearchResult:
        series_id = series.get('id') or self._series_id(search_result)
        if not isinstance(series_id, int | str):
            message = 'TVDB series id is missing'
            raise ImportProviderResponseError(message)
        season_number = coerce_int(season.get('number'), 0) or 0
        detail = season_detail or {}
        return ImportSearchResult(
            provider=self.name,
            external_id=build_external_id(series_id, season_number),
            title=self._season_title(series, {**season, **{key: value for key, value in detail.items() if value is not None}}, language=language) if include_season_in_title else self._search_title(search_result, series, language=language),
            original_title=first_non_empty(series.get('name'), search_result.get('name'), search_result.get('title')),
            summary=self._localized_summary(detail, language) or self._localized_summary(series, language) or first_non_empty(detail.get('overview'), season.get('overview'), series.get('overview'), search_result.get('overview')),
            air_date=self._search_air_date(season, detail),
            platform='tv',
            episode_count=self._season_episode_count(detail) or self._season_episode_count(season),
            image_url=self._poster_url(season) or self._poster_url(search_result) or self._poster_url(series),
            url=self._season_url(series, season_number) if include_season_in_title else self._series_url(series),
            raw_data={'search_result': search_result, 'series': self._series_summary(series), 'season': season},
        )

    def _search_title(self, search_result: dict[str, Any], series: dict[str, Any], *, language: str | None) -> str:
        return self._localized_name(series, language) or first_non_empty(series.get('name'), search_result.get('name'), search_result.get('title')) or 'Untitled'

    def _map_episode(
        self,
        series_id: int | str,
        episode: dict[str, Any],
        *,
        translations: dict[str, dict[str, Any]],
        language: str | None,
        airs_time: object,
        country: object,
    ) -> ImportEpisodeInfo:
        episode_number = coerce_int(episode.get('number'))
        if episode_number is None:
            message = 'TVDB episode number is missing'
            raise ImportProviderResponseError(message)
        episode_id = episode.get('id')
        original_language = _COUNTRY_ORIGINAL_LANGUAGES.get(str(country).strip().lower()) if country is not None else None
        original_title = first_non_empty(translations.get(original_language, {}).get('name')) if original_language is not None else None
        title = original_title or first_non_empty(episode.get('name')) or self._localized_translation_value(translations, 'name', language)
        air_at = parse_air_at(episode.get('aired'))
        return ImportEpisodeInfo(
            provider=self.name,
            external_id=str(episode_id) if isinstance(episode_id, int | str) else None,
            episode_number=episode_number,
            title=title,
            names=self._episode_names(episode, translations, title, allowed_languages=self._preferred_languages(language)),
            air_at=air_at,
            duration=runtime_to_duration(episode.get('runtime')),
            status=map_status(air_at),
            url=f'{self._web_base_url}/series/{series_id}/episodes/{episode_id}' if isinstance(episode_id, int | str) else None,
            raw_data={**episode, 'translations': translations},
            status_air_at=parse_status_air_at(episode.get('aired'), airs_time, country),
        )

    @staticmethod
    def _company_country(value: object) -> object:
        return value.get('country') if isinstance(value, dict) else None

    def _episode_items(self, season: dict[str, Any], season_number: int) -> list[dict[str, Any]]:
        episodes = season.get('episodes')
        if not isinstance(episodes, list):
            return []
        items: list[dict[str, Any]] = []
        for episode in episodes:
            if not isinstance(episode, dict):
                continue
            episode_season_number = coerce_int(episode.get('seasonNumber'), season_number)
            episode_number = coerce_int(episode.get('number'))
            if episode_season_number == season_number and episode_number is not None and episode_number > 0:
                items.append(episode)
        return sorted(items, key=lambda item: coerce_int(item.get('number'), 0) or 0)

    def _related_seasons(
        self,
        series: dict[str, Any],
        current_season_number: int,
        *,
        language: str | None,
        languages: list[str],
        series_translations: dict[str, dict[str, Any]],
    ) -> list[ImportRelatedAnime]:
        series_id = series.get('id')
        if not isinstance(series_id, int | str):
            return []
        seasons = [
            season
            for season in self._importable_seasons(series, include_specials=True)
            if (season_number := coerce_int(season.get('number'))) is not None and season_number != current_season_number
        ]
        if not seasons:
            return []
        workers = min(self._detail_fetch_workers, len(seasons))
        if workers <= 1:
            season_details = [self._season_detail_for_summary(season) or {} for season in seasons]
        else:
            with ThreadPoolExecutor(max_workers=workers) as executor:
                season_details = list(executor.map(lambda season: self._season_detail_for_summary(season) or {}, seasons))
        related: list[ImportRelatedAnime] = []
        for season, season_detail in zip(seasons, season_details, strict=True):
            season_number = coerce_int(season.get('number'))
            if season_number is None:
                continue
            merged_season = {**season, **{key: value for key, value in season_detail.items() if value is not None}}
            titles = [
                ImportAnimeName(
                    name=self._season_title(series, merged_season, language=title_language, translations=series_translations),
                    language=title_language,
                )
                for title_language in languages
                if first_non_empty(series_translations.get(title_language, {}).get('name')) is not None
            ]
            related.append(
                ImportRelatedAnime(
                    provider=self.name,
                    external_id=build_external_id(series_id, season_number),
                    title=self._season_title(series, merged_season, language=language),
                    relation_type='same_series_season',
                    season_number=season_number,
                    air_date=self._season_summary_air_date(merged_season),
                    episode_count=self._season_episode_count(merged_season),
                    url=self._season_url(series, season_number),
                    poster_source_url=self._poster_url(merged_season) or self._poster_url(series),
                    raw_data=season,
                    titles=titles,
                ),
            )
        return related

    def _season_title(
        self,
        series: dict[str, Any],
        season: dict[str, Any],
        *,
        language: str | None,
        translations: dict[str, dict[str, Any]] | None = None,
    ) -> str:
        series_name = self._localized_translation_value(translations or {}, 'name', language) or self._localized_name(series, language) or first_non_empty(series.get('name')) or 'Untitled'
        season_number = coerce_int(season.get('number'), 0) or 0
        season_name = self._localized_name(season, language) or first_non_empty(season.get('name'))
        generic = f'Season {season_number}'
        if season_name and season_name != generic:
            return f'{series_name}: {season_name}'
        return f'{series_name} Season {season_number}'

    def _poster_url(self, item: dict[str, Any]) -> str | None:
        value = first_non_empty(item.get('image'), item.get('image_url'), item.get('poster'), item.get('thumbnail'))
        if value is not None:
            return normalize_image_url(value)
        artworks = item.get('artwork') or item.get('artworks') or item.get('posters')
        if isinstance(artworks, list):
            for artwork in artworks:
                if isinstance(artwork, dict):
                    url = normalize_image_url(first_non_empty(artwork.get('image'), artwork.get('thumbnail'), artwork.get('url')))
                    if url is not None:
                        return url
        return None

    def _season_url(self, series: dict[str, Any], season_number: int) -> str:
        series_path = first_non_empty(series.get('slug')) or str(series.get('id'))
        return f'{self._web_base_url}/series/{series_path}/seasons/official/{season_number}'

    def _series_url(self, series: dict[str, Any]) -> str:
        series_path = first_non_empty(series.get('slug')) or str(series.get('id'))
        return f'{self._web_base_url}/series/{series_path}'

    def _search_air_date(self, season: dict[str, Any], season_detail: dict[str, Any]) -> str | None:
        first_episode_date = self._first_episode_air_date(season_detail)
        if first_episode_date is not None:
            return first_episode_date.isoformat()
        season_date = parse_date(first_non_empty(season.get('firstAired'), season.get('aired'), season.get('airDate'), season.get('releaseDate')))
        if season_date is not None:
            return season_date.isoformat()
        season_year = coerce_int(season.get('year'))
        if season_year is not None and season_year > 0:
            return f'{season_year:04d}-01-01'
        return None

    def _season_episode_count(self, season: dict[str, Any]) -> int | None:
        count = coerce_int(season.get('episode_count')) or coerce_int(season.get('episodeCount'))
        if count is not None:
            return count
        episodes = season.get('episodes')
        return len(episodes) if isinstance(episodes, list) else None

    def _series_summary(self, series: dict[str, Any]) -> dict[str, Any]:
        return {key: series.get(key) for key in ('id', 'name', 'overview', 'image', 'firstAired', 'year')}

    def _summaries(
        self,
        series: dict[str, Any],
        season: dict[str, Any],
        *,
        allowed_languages: list[str],
        series_translations: dict[str, dict[str, Any]],
        season_translations: dict[str, dict[str, Any]],
    ) -> list[ImportAnimeSummary]:
        summaries: list[ImportAnimeSummary] = []
        seen: set[tuple[str, str]] = set()
        for language in self._ordered_allowed_languages(allowed_languages, season_translations, series_translations):
            summary = first_non_empty(season_translations.get(language, {}).get('overview')) or first_non_empty(series_translations.get(language, {}).get('overview'))
            if summary is not None and (language, summary) not in seen:
                summaries.append(ImportAnimeSummary(language=language, summary=summary))
                seen.add((language, summary))
        for item_language, summary in self._translation_values(season, 'overview', allowed_languages=allowed_languages) + self._translation_values(series, 'overview', allowed_languages=allowed_languages):
            summary_language = item_language or 'und'
            if (summary_language, summary) not in seen:
                summaries.append(ImportAnimeSummary(language=summary_language, summary=summary))
                seen.add((summary_language, summary))
        fallback = first_non_empty(season.get('overview'), series.get('overview'))
        if fallback is not None and ('und', fallback) not in seen:
            summaries.append(ImportAnimeSummary(language='und', summary=fallback))
        return summaries

    def _names(
        self,
        series: dict[str, Any],
        season_summary: dict[str, Any],
        season: dict[str, Any],
        *,
        language: str | None,
        title: str,
        allowed_languages: list[str],
        series_translations: dict[str, dict[str, Any]],
        season_translations: dict[str, dict[str, Any]],
    ) -> list[ImportAnimeName]:
        candidates: list[tuple[str | None, str | None]] = []
        if language is not None:
            candidates.append((self._season_title(series, season_summary, language=language, translations=series_translations), language))
        for item_language in self._ordered_allowed_languages(allowed_languages, series_translations, season_translations):
            series_name = first_non_empty(series_translations.get(item_language, {}).get('name'))
            season_name = first_non_empty(season_translations.get(item_language, {}).get('name'))
            season_number = coerce_int(season_summary.get('number'), 0) or 0
            if series_name is not None and season_name is not None:
                candidates.append((f'{series_name}: {season_name}', item_language))
            elif series_name is not None:
                candidates.append((f'{series_name} Season {season_number}', item_language))
        if not any(value == title and item_language is not None for value, item_language in candidates):
            candidates.insert(0, (title, language))
        candidates.append((first_non_empty(series.get('name')), None))
        candidates.extend((name, item_language) for item_language, name in self._translation_values(season, 'name', allowed_languages=allowed_languages))
        candidates.extend((name, item_language) for item_language, name in self._translation_values(series, 'name', allowed_languages=allowed_languages))
        names: list[ImportAnimeName] = []
        seen: set[str] = set()
        for value, language in candidates:
            if value is not None and value not in seen:
                names.append(ImportAnimeName(name=value, language=language))
                seen.add(value)
        return names

    def _translation_values(
        self,
        item: dict[str, Any],
        field: str,
        *,
        allowed_languages: list[str] | None = None,
    ) -> list[tuple[str | None, str]]:
        translations = item.get('translations')
        values: list[tuple[str | None, str]] = []
        if isinstance(translations, dict):
            key = 'nameTranslations' if field == 'name' else 'overviewTranslations'
            records = translations.get(key)
            if isinstance(records, list):
                for record in records:
                    if isinstance(record, dict):
                        value = first_non_empty(record.get(field), record.get('overview'))
                        language = first_non_empty(record.get('language'), record.get('languageCode'), record.get('iso_639_3'))
                        if value is not None and self._language_allowed(language, allowed_languages):
                            values.append((language, value))
            for language, translation in translations.items():
                if isinstance(translation, dict):
                    value = first_non_empty(translation.get(field))
                    if value is not None and self._language_allowed(str(language), allowed_languages):
                        values.append((str(language), value))
        elif isinstance(translations, list):
            for translation in translations:
                if isinstance(translation, dict):
                    value = first_non_empty(translation.get(field))
                    language = first_non_empty(translation.get('language'), translation.get('languageCode'), translation.get('iso_639_3'))
                    if value is not None and self._language_allowed(language, allowed_languages):
                        values.append((language, value))
        return values

    def _language_allowed(self, language: str | None, allowed_languages: list[str] | None) -> bool:
        return allowed_languages is None or language in allowed_languages

    def _episode_names(
        self,
        episode: dict[str, Any],
        translations: dict[str, dict[str, Any]],
        title: str | None,
        *,
        allowed_languages: list[str],
    ) -> list[ImportEpisodeName]:
        names: list[ImportEpisodeName] = []
        seen: set[str] = set()
        for language in self._ordered_allowed_languages(allowed_languages, translations):
            name = first_non_empty(translations.get(language, {}).get('name'))
            if name is not None and name not in seen:
                names.append(ImportEpisodeName(name=name, language=language))
                seen.add(name)
        original = first_non_empty(episode.get('name'))
        for name, name_language in ((title, None), (original, None)):
            if name is not None and name not in seen:
                names.append(ImportEpisodeName(name=name, language=name_language))
                seen.add(name)
        return names

    def _localized_translation_value(self, translations: dict[str, dict[str, Any]], field: str, language: str | None) -> str | None:
        for item_language in self._preferred_languages(language):
            value = first_non_empty(translations.get(item_language, {}).get(field))
            if value is not None:
                return value
        for item_language in self._ordered_translation_languages(translations):
            value = first_non_empty(translations.get(item_language, {}).get(field))
            if value is not None:
                return value
        return None

    def _ordered_translation_languages(self, *translation_maps: dict[str, dict[str, Any]]) -> list[str]:
        languages: list[str] = []
        for value in self._required_detail_languages:
            if any(value in translations for translations in translation_maps):
                languages.append(value)
        for translations in translation_maps:
            for language in translations:
                if language not in languages:
                    languages.append(language)
        return languages

    def _ordered_allowed_languages(self, allowed_languages: list[str], *translation_maps: dict[str, dict[str, Any]]) -> list[str]:
        return [language for language in allowed_languages if any(language in translations for translations in translation_maps)]

    def _preferred_languages(self, language: str | None) -> list[str]:
        languages: list[str] = []
        for value in (language, *self._chinese_detail_languages, *self._required_detail_languages):
            if value is not None and value not in languages:
                languages.append(value)
        return languages

    def _localized_name(self, item: dict[str, Any], language: str | None) -> str | None:
        return self._localized_value(item, 'name', language)

    def _localized_summary(self, item: dict[str, Any], language: str | None) -> str | None:
        return self._localized_value(item, 'overview', language)

    def _localized_value(self, item: dict[str, Any], field: str, language: str | None) -> str | None:
        values = self._translation_values(item, field)
        for preferred in self._preferred_languages(language):
            for item_language, value in values:
                if item_language == preferred:
                    return value
        return values[0][1] if values else None

    def _detail_languages(self, language: str | None) -> list[str]:
        return self._preferred_languages(tvdb_language(language))

    def _season_air_date(self, season: dict[str, Any], episodes: list[ImportEpisodeInfo]) -> Any:
        dates = [episode.air_at.date() for episode in episodes if episode.air_at is not None]
        season_year = coerce_int(season.get('year'))
        year_date = parse_date(f'{season_year:04d}-01-01') if season_year is not None and season_year > 0 else None
        return min(dates) if dates else year_date

    def _season_summary_air_date(self, season: dict[str, Any]) -> Any:
        first_episode_date = self._first_episode_air_date(season)
        if first_episode_date is not None:
            return first_episode_date
        season_year = coerce_int(season.get('year'))
        if season_year is not None and season_year > 0:
            return parse_date(f'{season_year:04d}-01-01')
        return None

    def _first_episode_air_date(self, season: dict[str, Any]) -> Any:
        episodes = season.get('episodes')
        if not isinstance(episodes, list):
            return None
        dates = [parsed for episode in episodes if isinstance(episode, dict) and (parsed := parse_date(episode.get('aired'))) is not None]
        return min(dates) if dates else None

    def _anime_type(self, season_number: int) -> str:
        return 'special' if season_number == 0 else 'tv'
