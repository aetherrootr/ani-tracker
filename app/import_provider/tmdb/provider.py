from __future__ import annotations

import logging
from typing import Any

import requests

from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import ImportProviderResponseError, ImportProviderTimeoutError
from app.import_provider.tmdb.utils import (
    build_movie_external_id,
    build_tv_season_external_id,
    map_status,
    parse_air_at,
    parse_date,
    parse_external_id,
    runtime_to_duration,
)
from app.import_provider.types import (
    ImportAnimeDetail,
    ImportAnimeName,
    ImportAnimeSummary,
    ImportEpisodeInfo,
    ImportEpisodeName,
    ImportRelatedAnime,
    ImportSearchPage,
    ImportSearchResult,
)
from app.import_provider.utils import coerce_int, non_empty_str

logger = logging.getLogger(__name__)


class TmdbImportProvider(ImportProvider):
    name = 'tmdb'
    _tmdb_page_size = 20
    _required_detail_languages = ('en-US', 'zh-CN', 'zh-TW', 'ja-JP')

    def __init__(
        self,
        *,
        base_url: str,
        web_base_url: str,
        image_base_url: str,
        poster_size: str,
        access_token: str | None,
        api_key: str | None,
        include_adult: bool,
        timeout: float,
        session: requests.Session | None = None,
    ) -> None:
        self._base_url = base_url.rstrip('/')
        self._web_base_url = web_base_url.rstrip('/')
        self._image_base_url = image_base_url.rstrip('/')
        self._poster_size = poster_size.strip('/') or 'w500'
        self._access_token = access_token.strip() if access_token else None
        self._api_key = api_key.strip() if api_key else None
        self._include_adult = include_adult
        self._timeout = timeout
        self._session = session or requests.Session()

    def search_anime(self, keyword: str, *, limit: int, offset: int, language: str | None = None) -> ImportSearchPage:
        request_language = self._request_language(language)
        results: list[ImportSearchResult] = []
        page = offset // self._tmdb_page_size + 1
        total = 0
        # TV results expand into seasons, so fetch until the requested app page is filled
        # or TMDB reports that no more source pages exist.
        while len(results) < offset + limit:
            body = self._request_json(
                '/search/multi',
                params={'query': keyword, 'page': page, 'include_adult': str(self._include_adult).lower()},
                language=request_language,
            )
            if not isinstance(body, dict) or not isinstance(body.get('results'), list):
                message = 'TMDB search response is invalid'
                raise ImportProviderResponseError(message)
            total = coerce_int(body.get('total_results'), total) or 0
            for item in body['results']:
                if not isinstance(item, dict):
                    continue
                media_type = item.get('media_type')
                if media_type == 'movie':
                    mapped = self._map_movie_search(item)
                    if mapped is not None:
                        results.append(mapped)
                elif media_type == 'tv':
                    results.extend(self._map_tv_search(item, language=request_language))
            total_pages = coerce_int(body.get('total_pages'), page) or page
            if page >= total_pages:
                break
            page += 1
        return ImportSearchPage(total=max(total, len(results)), limit=limit, offset=offset, results=results[offset:offset + limit])

    def get_anime_detail(self, external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
        detail_languages = self._detail_languages(language)
        primary_language = detail_languages[0]
        media_type, media_id, season_number = parse_external_id(external_id)
        if media_type == 'movie':
            movie_by_language = self._fetch_detail_languages(f'/movie/{media_id}', detail_languages)
            movie = movie_by_language.get(primary_language)
            if movie is None:
                message = 'TMDB movie response is invalid'
                raise ImportProviderResponseError(message)
            return self._map_movie_detail(movie, localized_movies=movie_by_language)
        if season_number is None:
            message = 'Invalid TMDB external id'
            raise ImportProviderResponseError(message)
        series_by_language = self._fetch_detail_languages(f'/tv/{media_id}', detail_languages)
        series = series_by_language.get(primary_language)
        if series is None:
            message = 'TMDB TV response is invalid'
            raise ImportProviderResponseError(message)
        season_summary = self._find_season(series, season_number)
        season_by_language = self._fetch_detail_languages(f'/tv/{media_id}/season/{season_number}', detail_languages)
        season = season_by_language.get(primary_language)
        if season is None:
            message = 'TMDB TV season response is invalid'
            raise ImportProviderResponseError(message)
        return self._map_tv_detail(
            series,
            season_summary,
            season,
            language=primary_language,
            localized_series=series_by_language,
            localized_seasons=season_by_language,
        )

    def _fetch_detail_languages(self, path: str, languages: list[str]) -> dict[str, dict[str, Any]]:
        details: dict[str, dict[str, Any]] = {}
        for language in languages:
            body = self._request_json(path, language=language)
            if not isinstance(body, dict):
                continue
            details[language] = body
        return details

    def _request_json(self, path: str, *, params: dict[str, object] | None = None, language: str | None = None) -> object:
        if self._access_token is None and self._api_key is None:
            message = 'TMDB credentials are not configured'
            raise ImportProviderResponseError(message)
        request_params = {**(params or {})}
        request_language = self._request_language(language)
        if request_language is not None:
            request_params['language'] = request_language
        headers: dict[str, str] = {}
        if self._access_token is not None:
            headers['Authorization'] = f'Bearer {self._access_token}'
        elif self._api_key is not None:
            request_params['api_key'] = self._api_key
        try:
            response = self._session.get(f'{self._base_url}{path}', params=request_params, headers=headers, timeout=self._timeout)
        except requests.Timeout as exc:
            logger.warning('TMDB request timed out', exc_info=exc)
            message = 'TMDB request timed out'
            raise ImportProviderTimeoutError(message) from exc
        except requests.RequestException as exc:
            logger.warning('TMDB request failed', exc_info=exc)
            message = 'TMDB request failed'
            raise ImportProviderResponseError(message) from exc
        if not 200 <= response.status_code < 300:
            logger.warning('TMDB returned status code %s', response.status_code)
            message = 'TMDB returned an error response'
            raise ImportProviderResponseError(message)
        try:
            return response.json()
        except ValueError as exc:
            logger.warning('TMDB returned invalid JSON', exc_info=exc)
            message = 'TMDB returned invalid JSON'
            raise ImportProviderResponseError(message) from exc

    def _map_movie_search(self, movie: dict[str, Any]) -> ImportSearchResult | None:
        movie_id = movie.get('id')
        if not isinstance(movie_id, int | str):
            return None
        title = non_empty_str(movie.get('title')) or non_empty_str(movie.get('original_title')) or 'Untitled'
        external_id = build_movie_external_id(movie_id)
        return ImportSearchResult(
            provider=self.name,
            external_id=external_id,
            title=title,
            original_title=non_empty_str(movie.get('original_title')),
            summary=non_empty_str(movie.get('overview')),
            air_date=non_empty_str(movie.get('release_date')),
            platform='movie',
            episode_count=1,
            image_url=self._poster_url(movie.get('poster_path')),
            url=f'{self._web_base_url}/movie/{movie_id}',
            raw_data=movie,
        )

    def _map_tv_search(self, series: dict[str, Any], *, language: str | None) -> list[ImportSearchResult]:
        series_id = series.get('id')
        if not isinstance(series_id, int | str):
            return []
        details = self._request_json(f'/tv/{series_id}', language=language)
        if not isinstance(details, dict) or not isinstance(details.get('seasons'), list):
            return []
        return [self._map_tv_season_search(details, season) for season in details['seasons'] if isinstance(season, dict) and coerce_int(season.get('season_number')) not in {None, 0}]

    def _map_tv_season_search(self, series: dict[str, Any], season: dict[str, Any]) -> ImportSearchResult:
        series_id = series['id']
        season_number = coerce_int(season.get('season_number'), 0) or 0
        title = self._season_title(series, season)
        return ImportSearchResult(
            provider=self.name,
            external_id=build_tv_season_external_id(series_id, season_number),
            title=title,
            original_title=non_empty_str(series.get('original_name')),
            summary=non_empty_str(season.get('overview')) or non_empty_str(series.get('overview')),
            air_date=non_empty_str(season.get('air_date')) or non_empty_str(series.get('first_air_date')),
            platform='tv',
            episode_count=coerce_int(season.get('episode_count')),
            image_url=self._poster_url(season.get('poster_path') or series.get('poster_path')),
            url=f'{self._web_base_url}/tv/{series_id}/season/{season_number}',
            raw_data={'series': series, 'season': season},
        )

    def _map_movie_detail(
        self,
        movie: dict[str, Any],
        *,
        localized_movies: dict[str, dict[str, Any]],
    ) -> ImportAnimeDetail:
        movie_id = movie.get('id')
        if not isinstance(movie_id, int | str):
            message = 'TMDB movie id is missing'
            raise ImportProviderResponseError(message)
        title = non_empty_str(movie.get('title')) or non_empty_str(movie.get('original_title')) or 'Untitled'
        original_title = non_empty_str(movie.get('original_title'))
        air_at = parse_air_at(movie.get('release_date'))
        name_items = [(non_empty_str(item.get('title')), item_language) for item_language, item in localized_movies.items()]
        name_items.append((original_title, non_empty_str(movie.get('original_language'))))
        names = self._names(*name_items)
        external_id = build_movie_external_id(movie_id)
        return ImportAnimeDetail(
            provider=self.name,
            external_id=external_id,
            title=title,
            original_title=original_title,
            summaries=self._localized_summaries(localized_movies),
            poster_source_url=self._poster_url(movie.get('poster_path')),
            anime_type='movie',
            total_episodes=1,
            url=f'{self._web_base_url}/movie/{movie_id}',
            names=names,
            episodes=[ImportEpisodeInfo(provider=self.name, external_id=external_id, episode_number=1, title=title, names=[ImportEpisodeName(name=item.name, language=item.language) for item in names], air_at=air_at, duration=runtime_to_duration(movie.get('runtime')), status=map_status(air_at), url=f'{self._web_base_url}/movie/{movie_id}', raw_data=movie)],
            raw_data=movie,
            air_date=parse_date(movie.get('release_date')),
        )

    def _map_tv_detail(
        self,
        series: dict[str, Any],
        season_summary: dict[str, Any],
        season: dict[str, Any],
        *,
        language: str,
        localized_series: dict[str, dict[str, Any]],
        localized_seasons: dict[str, dict[str, Any]],
    ) -> ImportAnimeDetail:
        series_id = series.get('id')
        season_number = coerce_int(season.get('season_number'))
        if not isinstance(series_id, int | str) or season_number is None:
            message = 'TMDB TV season id is missing'
            raise ImportProviderResponseError(message)
        title = self._season_title(series, season)
        original_title = non_empty_str(series.get('original_name'))
        episodes = [self._map_tv_episode(series_id, season_number, episode, series, language=language) for episode in season.get('episodes', []) if isinstance(episode, dict)]
        return ImportAnimeDetail(
            provider=self.name,
            external_id=build_tv_season_external_id(series_id, season_number),
            title=title,
            original_title=original_title,
            summaries=self._localized_tv_summaries(localized_series, localized_seasons),
            poster_source_url=self._poster_url(season.get('poster_path') or season_summary.get('poster_path') or series.get('poster_path')),
            anime_type='tv',
            total_episodes=coerce_int(season_summary.get('episode_count'), len(episodes)) or len(episodes),
            url=f'{self._web_base_url}/tv/{series_id}/season/{season_number}',
            names=self._localized_tv_names(localized_series, localized_seasons, original_title),
            episodes=episodes,
            raw_data={'series': series, 'season_summary': season_summary, 'season': season},
            air_date=parse_date(season.get('air_date')) or self._first_episode_date(episodes) or parse_date(series.get('first_air_date')),
            related_anime=self._related_seasons(series, season_number),
        )

    def _map_tv_episode(
        self,
        series_id: int | str,
        season_number: int,
        episode: dict[str, Any],
        series: dict[str, Any],
        *,
        language: str,
    ) -> ImportEpisodeInfo:
        episode_number = coerce_int(episode.get('episode_number'))
        if episode_number is None:
            message = 'TMDB episode number is missing'
            raise ImportProviderResponseError(message)
        title = non_empty_str(episode.get('name'))
        air_at = parse_air_at(episode.get('air_date'))
        duration = runtime_to_duration(episode.get('runtime'))
        if duration is None and isinstance(series.get('episode_run_time'), list) and series['episode_run_time']:
            duration = runtime_to_duration(series['episode_run_time'][0])
        return ImportEpisodeInfo(
            provider=self.name,
            external_id=f'tv:{series_id}:season:{season_number}:episode:{episode_number}',
            episode_number=episode_number,
            title=title,
            names=[ImportEpisodeName(name=title, language=language)] if title is not None else [],
            air_at=air_at,
            duration=duration,
            status=map_status(air_at),
            url=f'{self._web_base_url}/tv/{series_id}/season/{season_number}/episode/{episode_number}',
            raw_data=episode,
        )

    def _related_seasons(self, series: dict[str, Any], current_season_number: int) -> list[ImportRelatedAnime]:
        series_id = series.get('id')
        seasons = series.get('seasons')
        if not isinstance(series_id, int | str) or not isinstance(seasons, list):
            return []
        related: list[ImportRelatedAnime] = []
        for season in seasons:
            if not isinstance(season, dict):
                continue
            season_number = coerce_int(season.get('season_number'))
            if season_number in {None, 0, current_season_number}:
                continue
            related.append(
                ImportRelatedAnime(
                    provider=self.name,
                    external_id=build_tv_season_external_id(series_id, season_number),
                    title=self._season_title(series, season),
                    relation_type='same_series_season',
                    season_number=season_number,
                    air_date=parse_date(season.get('air_date')) or parse_date(series.get('first_air_date')),
                    episode_count=coerce_int(season.get('episode_count')),
                    url=f'{self._web_base_url}/tv/{series_id}/season/{season_number}',
                    poster_source_url=self._poster_url(season.get('poster_path') or series.get('poster_path')),
                    raw_data=season,
                ),
            )
        return related

    def _find_season(self, series: dict[str, Any], season_number: int) -> dict[str, Any]:
        seasons = series.get('seasons')
        if not isinstance(seasons, list):
            message = 'TMDB TV seasons response is invalid'
            raise ImportProviderResponseError(message)
        for season in seasons:
            if isinstance(season, dict) and coerce_int(season.get('season_number')) == season_number:
                return season
        message = 'TMDB TV season does not exist'
        raise ImportProviderResponseError(message)

    def _poster_url(self, poster_path: object) -> str | None:
        if not isinstance(poster_path, str) or not poster_path.strip():
            return None
        return f'{self._image_base_url}/{self._poster_size}{poster_path}'

    def _season_title(self, series: dict[str, Any], season: dict[str, Any]) -> str:
        series_name = non_empty_str(series.get('name')) or non_empty_str(series.get('original_name')) or 'Untitled'
        season_number = coerce_int(season.get('season_number'), 0) or 0
        season_name = non_empty_str(season.get('name'))
        generic = f'Season {season_number}'
        if season_name and season_name != generic:
            return f'{series_name}: {season_name}'
        return f'{series_name} Season {season_number}'

    def _names(self, *items: tuple[str | None, str | None]) -> list[ImportAnimeName]:
        names: list[ImportAnimeName] = []
        seen: set[str] = set()
        for value, language in items:
            if value is not None and value not in seen:
                names.append(ImportAnimeName(name=value, language=language))
                seen.add(value)
        return names

    def _summaries(self, value: object, *, language: str) -> list[ImportAnimeSummary]:
        summary = non_empty_str(value)
        return [ImportAnimeSummary(language=language, summary=summary)] if summary is not None else []

    def _localized_summaries(self, localized_items: dict[str, dict[str, Any]]) -> list[ImportAnimeSummary]:
        summaries: list[ImportAnimeSummary] = []
        seen: set[tuple[str, str]] = set()
        for language, item in localized_items.items():
            summary = non_empty_str(item.get('overview'))
            if summary is None or (language, summary) in seen:
                continue
            summaries.append(ImportAnimeSummary(language=language, summary=summary))
            seen.add((language, summary))
        return summaries

    def _localized_tv_summaries(
        self,
        localized_series: dict[str, dict[str, Any]],
        localized_seasons: dict[str, dict[str, Any]],
    ) -> list[ImportAnimeSummary]:
        summaries: list[ImportAnimeSummary] = []
        seen: set[tuple[str, str]] = set()
        for language, season in localized_seasons.items():
            series = localized_series.get(language, {})
            summary = non_empty_str(season.get('overview')) or non_empty_str(series.get('overview'))
            if summary is None or (language, summary) in seen:
                continue
            summaries.append(ImportAnimeSummary(language=language, summary=summary))
            seen.add((language, summary))
        return summaries

    def _localized_tv_names(
        self,
        localized_series: dict[str, dict[str, Any]],
        localized_seasons: dict[str, dict[str, Any]],
        original_title: str | None,
    ) -> list[ImportAnimeName]:
        items: list[tuple[str | None, str | None]] = []
        for language, season in localized_seasons.items():
            series = localized_series.get(language, {})
            items.append((self._season_title(series, season), language))
        original_language = next(
            (non_empty_str(item.get('original_language')) for item in localized_series.values() if non_empty_str(item.get('original_language')) is not None),
            None,
        )
        items.append((original_title, original_language))
        return self._names(*items)

    def _request_language(self, language: str | None) -> str | None:
        return language.strip() if isinstance(language, str) and language.strip() else None

    def _detail_languages(self, language: str | None) -> list[str]:
        languages: list[str] = []
        request_language = self._request_language(language)
        for value in (request_language, *self._required_detail_languages):
            if value is not None and value not in languages:
                languages.append(value)
        return languages

    def _first_episode_date(self, episodes: list[ImportEpisodeInfo]) -> Any:
        dates = [episode.air_at.date() for episode in episodes if episode.air_at is not None]
        return min(dates) if dates else None
