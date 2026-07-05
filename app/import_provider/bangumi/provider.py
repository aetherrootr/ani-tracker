from __future__ import annotations

import logging

import requests

from app.import_provider.bangumi.utils import pick_episode_count, pick_image_url
from app.import_provider.exceptions import (
    ImportProviderResponseError,
    ImportProviderTimeoutError,
)
from app.import_provider.types import ImportSearchPage, ImportSearchResult
from app.import_provider.utils import coerce_int, non_empty_str

logger = logging.getLogger(__name__)


class BangumiImportProvider:
    name = 'bangumi'

    def __init__(
        self,
        *,
        base_url: str,
        user_agent: str,
        timeout: float,
        session: requests.Session | None = None,
    ) -> None:
        self._base_url = base_url.rstrip('/')
        self._user_agent = user_agent
        self._timeout = timeout
        self._session = session or requests.Session()

    def search_anime(self, keyword: str, *, limit: int, offset: int, nsfw: bool = False) -> ImportSearchPage:
        try:
            response = self._session.post(
                f'{self._base_url}/v0/search/subjects',
                params={'limit': limit, 'offset': offset},
                json={
                    'keyword': keyword,
                    'sort': 'match',
                    'filter': {'type': [2], 'nsfw': nsfw},
                },
                headers={'User-Agent': self._user_agent},
                timeout=self._timeout,
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
            body = response.json()
        except ValueError as exc:
            logger.warning('Bangumi returned invalid JSON', exc_info=exc)
            message = 'Bangumi returned invalid JSON'
            raise ImportProviderResponseError(message) from exc

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
            url=f'https://bgm.tv/subject/{external_id}',
            raw_data=subject,
        )
