from __future__ import annotations

import logging
from datetime import date
from typing import Any

import requests

from app.import_provider.bangumi.utils import (
    jst_status_air_at,
    map_anime_type,
    map_episode_status,
    parse_air_at,
    parse_duration,
    pick_episode_count,
    pick_image_url,
)
from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import (
    ImportProviderResponseError,
    ImportProviderTimeoutError,
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

BANGUMI_AUTO_IMPORT_RELATIONS = {'续集', '前传'}


class BangumiImportProvider(ImportProvider):
    name = 'bangumi'

    def __init__(
        self,
        *,
        base_url: str,
        web_base_url: str,
        user_agent: str,
        timeout: float,
        session: requests.Session | None = None,
    ) -> None:
        self._base_url = base_url.rstrip('/')
        self._web_base_url = web_base_url.rstrip('/')
        self._user_agent = user_agent
        self._timeout = timeout
        self._session = session or requests.Session()

    def search_anime(
        self,
        keyword: str,
        *,
        limit: int,
        offset: int,
        language: str | None = None,
        nsfw: bool = False,
    ) -> ImportSearchPage:
        _ = language
        body = self._request_json(
            'post',
            '/v0/search/subjects',
            params={'limit': limit, 'offset': offset},
            json={
                'keyword': keyword,
                'sort': 'match',
                'filter': {'type': [2], 'nsfw': nsfw},
            },
        )
        if not isinstance(body, dict):
            logger.warning('Bangumi returned non-object JSON: %s', type(body).__name__)
            message = 'Bangumi returned an invalid response'
            raise ImportProviderResponseError(message)

        data = body.get('data')
        if not isinstance(data, list):
            logger.warning('Bangumi response data has invalid type: %s', type(data).__name__)
            message = 'Bangumi response data is invalid'
            raise ImportProviderResponseError(message)

        results = [result for item in data if (result := self._map_subject(item)) is not None]
        total = coerce_int(body.get('total'), len(results))
        response_limit = coerce_int(body.get('limit'), limit)
        response_offset = coerce_int(body.get('offset'), offset)

        return ImportSearchPage(
            total=total if total is not None else 0,
            limit=response_limit if response_limit is not None else limit,
            offset=response_offset if response_offset is not None else offset,
            results=results,
        )

    def get_anime_detail(self, external_id: str, *, language: str | None = None) -> ImportAnimeDetail:
        _ = language
        subject = self._request_json('get', f'/v0/subjects/{external_id}')
        if not isinstance(subject, dict):
            message = 'Bangumi subject response is invalid'
            raise ImportProviderResponseError(message)

        episodes = self._fetch_episodes(external_id)
        related_subjects = self._fetch_related_subject_chain(external_id)
        return self._map_detail(subject, episodes, related_subjects)

    def _request_json(self, method: str, path: str, **kwargs: Any) -> object:
        request = self._session.post if method == 'post' else self._session.get
        try:
            response = request(
                f'{self._base_url}{path}',
                headers={'User-Agent': self._user_agent},
                timeout=self._timeout,
                **kwargs,
            )
        except requests.Timeout as exc:
            logger.warning('Bangumi request timed out', exc_info=exc)
            message = 'Bangumi request timed out'
            raise ImportProviderTimeoutError(message) from exc
        except requests.RequestException as exc:
            logger.warning('Bangumi request failed', exc_info=exc)
            message = 'Bangumi request failed'
            raise ImportProviderResponseError(message) from exc

        if not 200 <= response.status_code < 300:
            logger.warning('Bangumi returned status code %s', response.status_code)
            message = 'Bangumi returned an error response'
            raise ImportProviderResponseError(message)

        try:
            return response.json()
        except ValueError as exc:
            logger.warning('Bangumi returned invalid JSON', exc_info=exc)
            message = 'Bangumi returned invalid JSON'
            raise ImportProviderResponseError(message) from exc

    def _fetch_episodes(self, subject_id: str) -> list[dict[str, Any]]:
        limit = 100
        offset = 0
        episodes: list[dict[str, Any]] = []
        total: int | None = None

        while total is None or len(episodes) < total:
            body = self._request_json(
                'get',
                '/v0/episodes',
                params={'subject_id': subject_id, 'type': 0, 'limit': limit, 'offset': offset},
            )
            if not isinstance(body, dict) or not isinstance(body.get('data'), list):
                message = 'Bangumi episodes response is invalid'
                raise ImportProviderResponseError(message)
            page_data = [item for item in body['data'] if isinstance(item, dict)]
            if not page_data:
                break
            episodes.extend(page_data)
            total = coerce_int(body.get('total'), len(episodes))
            offset += limit

        return episodes

    def _fetch_related_subjects(self, subject_id: str) -> list[dict[str, Any]]:
        body = self._request_json('get', f'/v0/subjects/{subject_id}/subjects')
        if not isinstance(body, list):
            message = 'Bangumi related subjects response is invalid'
            raise ImportProviderResponseError(message)
        return [item for item in body if isinstance(item, dict)]

    def _fetch_related_subject_chain(self, subject_id: str) -> list[dict[str, Any]]:
        visited = {subject_id}
        queue = [subject_id]
        related_by_id: dict[str, dict[str, Any]] = {}

        index = 0
        while index < len(queue):
            current_id = queue[index]
            index += 1
            for subject in self._fetch_related_subjects(current_id):
                related_id = self._related_subject_id(subject)
                if related_id is None or related_id in visited:
                    continue
                if not self._is_auto_import_related_subject(subject):
                    continue
                visited.add(related_id)
                related_by_id[related_id] = subject
                queue.append(related_id)

        return list(related_by_id.values())

    def _map_subject(self, subject: object) -> ImportSearchResult | None:
        if not isinstance(subject, dict):
            return None

        subject_id = subject.get('id')
        if not isinstance(subject_id, int | str):
            return None

        name = non_empty_str(subject.get('name'))
        name_cn = non_empty_str(subject.get('name_cn'))
        external_id = str(subject_id)
        title = name_cn or name or 'Untitled'

        return ImportSearchResult(
            provider=self.name,
            external_id=external_id,
            title=title,
            original_title=name,
            summary=non_empty_str(subject.get('summary')),
            air_date=non_empty_str(subject.get('date')),
            platform=non_empty_str(subject.get('platform')),
            episode_count=pick_episode_count(subject),
            image_url=pick_image_url(subject.get('images')),
            url=f'{self._web_base_url}/subject/{external_id}',
            raw_data=subject,
        )

    def _map_detail(
        self,
        subject: dict[str, Any],
        episodes: list[dict[str, Any]],
        related_subjects: list[dict[str, Any]],
    ) -> ImportAnimeDetail:
        subject_id = subject.get('id')
        if not isinstance(subject_id, int | str):
            message = 'Bangumi subject id is missing'
            raise ImportProviderResponseError(message)

        external_id = str(subject_id)
        name = non_empty_str(subject.get('name'))
        name_cn = non_empty_str(subject.get('name_cn'))
        title = name or name_cn or 'Untitled'
        summary = non_empty_str(subject.get('summary'))
        names: list[ImportAnimeName] = []
        seen_names: set[str] = set()
        for value, language in ((name_cn, 'zh'), (name, 'ja')):
            if value is not None and value not in seen_names:
                names.append(ImportAnimeName(name=value, language=language))
                seen_names.add(value)

        return ImportAnimeDetail(
            provider=self.name,
            external_id=external_id,
            title=title,
            original_title=name,
            summaries=[ImportAnimeSummary(language='und', summary=summary)] if summary is not None else [],
            poster_source_url=pick_image_url(subject.get('images')),
            anime_type=map_anime_type(non_empty_str(subject.get('platform'))),
            total_episodes=pick_episode_count(subject),
            url=f'{self._web_base_url}/subject/{external_id}',
            names=names,
            episodes=[episode for item in episodes if (episode := self._map_episode(item)) is not None],
            raw_data=subject,
            air_date=self._pick_air_date(subject, episodes),
            related_anime=[item for related in related_subjects if (item := self._map_related_subject(related)) is not None],
        )

    def _map_related_subject(self, subject: dict[str, Any]) -> ImportRelatedAnime | None:
        if not self._is_auto_import_related_subject(subject):
            return None
        external_id = self._related_subject_id(subject)
        if external_id is None:
            return None
        name_cn = non_empty_str(subject.get('name_cn'))
        name = non_empty_str(subject.get('name'))
        return ImportRelatedAnime(
            provider=self.name,
            external_id=external_id,
            title=name_cn or name or 'Untitled',
            relation_type='same_series_season',
            season_number=None,
            air_date=None,
            episode_count=None,
            url=f'{self._web_base_url}/subject/{external_id}',
            poster_source_url=pick_image_url(subject.get('images')),
            raw_data=subject,
            titles=[
                ImportAnimeName(name=value, language=language)
                for value, language in ((name_cn, 'zh'), (name, 'ja'))
                if value is not None
            ],
        )

    def _is_auto_import_related_subject(self, subject: dict[str, Any]) -> bool:
        return subject.get('type') == 2 and subject.get('relation') in BANGUMI_AUTO_IMPORT_RELATIONS

    def _related_subject_id(self, subject: dict[str, Any]) -> str | None:
        subject_id = subject.get('id')
        return str(subject_id) if isinstance(subject_id, int | str) else None

    def _pick_air_date(self, subject: dict[str, Any], episodes: list[dict[str, Any]]) -> date | None:
        air_at = parse_air_at(subject.get('date'))
        if air_at is not None:
            return air_at.date()
        episode_dates = [air_at.date() for item in episodes if (air_at := parse_air_at(item.get('airdate'))) is not None]
        return min(episode_dates) if episode_dates else None

    def _map_episode(self, episode: dict[str, Any]) -> ImportEpisodeInfo | None:
        episode_number = coerce_int(episode.get('sort'))
        if episode_number is None:
            episode_number = coerce_int(episode.get('ep'))
        if episode_number is None:
            return None

        episode_id = episode.get('id')
        external_id = str(episode_id) if isinstance(episode_id, int | str) else None
        name_cn = non_empty_str(episode.get('name_cn'))
        name = non_empty_str(episode.get('name'))
        title = name or name_cn
        names: list[ImportEpisodeName] = []
        seen_names: set[str] = set()
        for value, language in ((name_cn, 'zh'), (name, 'ja')):
            if value is not None and value not in seen_names:
                names.append(ImportEpisodeName(name=value, language=language))
                seen_names.add(value)
        air_at = parse_air_at(episode.get('airdate'))
        status_air_at = jst_status_air_at(air_at)
        return ImportEpisodeInfo(
            provider=self.name,
            external_id=external_id,
            episode_number=episode_number,
            title=title,
            names=names,
            air_at=air_at,
            duration=parse_duration(episode.get('duration')),
            status=map_episode_status(status_air_at),
            url=f'{self._web_base_url}/ep/{external_id}' if external_id is not None else None,
            raw_data=episode,
            status_air_at=status_air_at,
        )
