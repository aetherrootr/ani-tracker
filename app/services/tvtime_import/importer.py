from __future__ import annotations

import csv
import io
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from operator import itemgetter
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.import_provider.base import ImportProvider
from app.import_provider.exceptions import ImportProviderResponseError, ImportProviderTimeoutError
from app.import_provider.tvdb.utils import build_external_id, coerce_int
from app.import_provider.types import ImportAnimeDetail
from app.models.anime import AnimeMetaInfo, Episode
from app.models.progress import UserAnimeProgress, UserAnimeStatus, UserEpisodeProgress
from app.models.user import User
from app.services.anime_library import populate_anime_from_detail, recalculate_user_anime_progress

EXPECTED_CSV_FILES = {
    'tracking-prod-records-v2.csv',
    'seen_episode.csv',
    'seen_episode_latest.csv',
    'seen_episode_unitarian.csv',
    'show_seen_episode_latest.csv',
    'followed_tv_show.csv',
    'user_tv_show_data.csv',
    'user_show_special_status.csv',
    'rewatched_episode.csv',
}


@dataclass(frozen=True)
class TvtimeImportOptions:
    backend: str = 'tvdb'
    dry_run: bool = True
    include_followed: bool = True
    tvdb_workers: int = 2


@dataclass(frozen=True)
class WatchRecord:
    series_id: str
    season_number: int
    episode_number: int
    watched_at: datetime | None
    series_name: str | None
    source_file: str
    source_row: int
    raw: dict[str, str]


def run_tvtime_import(
    session: Session,
    user: User,
    provider: ImportProvider,
    files: dict[str, bytes],
    options: TvtimeImportOptions,
    progress_callback: Callable[[dict[str, Any], dict[str, Any]], None] | None = None,
    provider_factory: Callable[[], ImportProvider] | None = None,
) -> dict[str, Any]:
    report = _new_report(user, options)
    _notify_progress(report, progress_callback)
    records, library_rows = _parse_files(files, report, include_followed=options.include_followed)
    deduped = _dedupe_watch_records(records, report)
    seasons = {(record.series_id, record.season_number) for record in deduped.values()}

    if options.include_followed:
        for row in library_rows:
            series_id = row['seriesId']
            season_numbers = _season_numbers_for_library_series(provider, series_id)
            if not season_numbers:
                _add_unresolved(
                    report,
                    'library_show_without_resolvable_seasons',
                    row['sourceFile'],
                    row['sourceRow'],
                    series_id=series_id,
                    series_name=row.get('tvShowName'),
                    raw=row['raw'],
                    extra={'nbEpisodesSeen': row.get('nbEpisodesSeen')},
                )
                continue
            seasons.update((series_id, season_number) for season_number in season_numbers)

    report['summary']['parsedRecords'] = len(records)
    report['summary']['uniqueWatchedRecords'] = len(deduped)
    report['summary']['animeSeasonsQueued'] = len(seasons)
    report['progress'] = _progress('importing_metadata', 0, len(seasons), 'Importing provider metadata')
    _notify_progress(report, progress_callback)

    anime_by_season = _import_metadata_parallel(
        session,
        provider,
        seasons=sorted(seasons, key=itemgetter(0, 1)),
        language=user.language_preference,
        options=options,
        report=report,
        records=deduped.values(),
        progress_callback=progress_callback,
        provider_factory=provider_factory,
    )

    report['progress'] = _progress('writing_progress', 0, len(deduped), 'Writing watched episodes')
    _notify_progress(report, progress_callback)
    touched_progress: set[int] = set()
    for index, record in enumerate(deduped.values(), start=1):
        anime = anime_by_season.get((record.series_id, record.season_number))
        if anime is None:
            report['progress'] = _progress('writing_progress', index, len(deduped), 'Writing watched episodes')
            continue
        episode = session.scalar(
            select(Episode).where(Episode.anime_id == anime.id, Episode.episode_number == record.episode_number),
        )
        if episode is None:
            _add_unresolved(
                report,
                'missing_episode_after_provider_import',
                record.source_file,
                record.source_row,
                series_id=record.series_id,
                series_name=record.series_name,
                season_number=record.season_number,
                episode_number=record.episode_number,
                raw=record.raw,
            )
            report['progress'] = _progress('writing_progress', index, len(deduped), 'Writing watched episodes')
            continue
        progress = _get_or_create_anime_progress(session, user_id=user.id, anime_id=anime.id)
        touched_progress.add(progress.id)
        outcome = _upsert_episode_progress(session, user_id=user.id, episode_id=episode.id, watched_at=record.watched_at)
        report['summary'][outcome] += 1
        if progress.status == UserAnimeStatus.PLAN_TO_WATCH:
            progress.status = UserAnimeStatus.WATCHING
        recalculate_user_anime_progress(session, progress=progress, marked_watched=True)
        report['progress'] = _progress('writing_progress', index, len(deduped), 'Writing watched episodes')
        _notify_progress(report, progress_callback)

    if options.include_followed:
        _ensure_library_progress(session, user.id, anime_by_season.values(), touched_progress, report)

    report['progress'] = _progress('generating_report', 1, 1, 'Generating report')
    _notify_progress(report, progress_callback)
    report['summary']['unresolvedRecords'] = len(report['unresolved'])
    report['summary']['extraWatchEvents'] = len(report['extraWatchEvents'])
    report['progress'] = _progress('completed', 1, 1, 'Import completed')
    _notify_progress(report, progress_callback)

    if options.dry_run:
        session.rollback()
    else:
        session.commit()
    return report


def _parse_files(files: dict[str, bytes], report: dict[str, Any], *, include_followed: bool) -> tuple[list[WatchRecord], list[dict[str, Any]]]:
    records: list[WatchRecord] = []
    library_rows: list[dict[str, Any]] = []
    name_to_ids = _build_name_mapping(files)
    if 'tracking-prod-records-v2.csv' not in files and not include_followed:
        report['warnings'].append({'message': 'tracking-prod-records-v2.csv is missing'})

    for filename, rows in _read_csv_files(files).items():
        if filename == 'rewatched_episode.csv':
            for row_number, row in rows:
                report['extraWatchEvents'].append({'sourceFile': filename, 'sourceRow': row_number, 'raw': row})
            continue
        if filename == 'tracking-prod-records-v2.csv':
            for row_number, row in rows:
                event_key = f"{row.get('gsi', '')} {row.get('key', '')}".lower()
                if 'watch-episode' not in event_key and 'rewatch-episode' not in event_key:
                    continue
                record = _record_from_row(filename, row_number, row, series_id=row.get('s_id'), season=row.get('season_number') or row.get('s_no'), episode=row.get('episode_number') or row.get('ep_no'), series_name=row.get('series_name'))
                if record is None:
                    _add_unresolved_from_row(report, filename, row_number, row)
                elif 'rewatch-episode' in event_key:
                    report['extraWatchEvents'].append(_record_context(record, reason='rewatch'))
                else:
                    records.append(record)
            continue
        if filename.startswith('seen_episode'):
            for row_number, row in rows:
                show_name = _clean(row.get('tv_show_name'))
                series_id = _unique_series_id(show_name, name_to_ids)
                if series_id is None:
                    _add_unresolved(report, 'unknown_show_id' if show_name not in name_to_ids else 'ambiguous_show_name', filename, row_number, series_name=show_name, raw=row)
                    continue
                record = _record_from_row(filename, row_number, row, series_id=series_id, season=row.get('episode_season_number'), episode=row.get('episode_number'), series_name=show_name)
                if record is None:
                    _add_unresolved_from_row(report, filename, row_number, row, series_id=series_id, series_name=show_name)
                else:
                    records.append(record)
            continue
        if include_followed and filename == 'user_tv_show_data.csv':
            for row_number, row in rows:
                series_id = _clean(row.get('tv_show_id'))
                if not series_id:
                    continue
                if _parse_bool(row.get('is_followed')) or row:
                    library_rows.append(
                        {
                            'seriesId': series_id,
                            'tvShowName': _clean(row.get('tv_show_name')),
                            'nbEpisodesSeen': _clean(row.get('nb_episodes_seen')),
                            'sourceFile': filename,
                            'sourceRow': row_number,
                            'raw': row,
                        },
                    )
    return records, library_rows


def _record_from_row(
    source_file: str,
    source_row: int,
    row: dict[str, str],
    *,
    series_id: str | None,
    season: str | None,
    episode: str | None,
    series_name: str | None,
) -> WatchRecord | None:
    clean_series_id = _clean(series_id)
    season_number = _parse_int(season)
    episode_number = _parse_int(episode)
    if not clean_series_id or season_number is None or episode_number is None:
        return None
    return WatchRecord(
        series_id=clean_series_id,
        season_number=season_number,
        episode_number=episode_number,
        watched_at=_parse_datetime(row.get('created_at')),
        series_name=_clean(series_name),
        source_file=source_file,
        source_row=source_row,
        raw=row,
    )


def _dedupe_watch_records(records: list[WatchRecord], report: dict[str, Any]) -> dict[tuple[str, int, int], WatchRecord]:
    deduped: dict[tuple[str, int, int], WatchRecord] = {}
    for record in records:
        key = (record.series_id, record.season_number, record.episode_number)
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = record
            continue
        report['summary']['skippedDuplicates'] += 1
        report['extraWatchEvents'].append(_record_context(record, reason='duplicate_watch_event'))
        if _is_earlier(record.watched_at, existing.watched_at):
            deduped[key] = record
    return deduped


def _upsert_episode_progress(session: Session, *, user_id: int, episode_id: int, watched_at: datetime | None) -> str:
    progress = session.scalar(select(UserEpisodeProgress).where(UserEpisodeProgress.user_id == user_id, UserEpisodeProgress.episode_id == episode_id))
    if progress is None:
        session.add(UserEpisodeProgress(user_id=user_id, episode_id=episode_id, watched=True, watched_at=watched_at))
        return 'importedEpisodeProgress'
    if not progress.watched:
        progress.watched = True
        progress.watched_at = watched_at
        return 'updatedEpisodeProgress'
    if progress.watched_at is None and watched_at is not None:
        progress.watched_at = watched_at
        return 'updatedEpisodeProgress'
    if watched_at is not None and progress.watched_at is not None and watched_at < progress.watched_at:
        progress.watched_at = watched_at
        return 'updatedEpisodeProgress'
    return 'existingDataPreserved'


def _import_metadata_parallel(
    session: Session,
    provider: ImportProvider,
    *,
    seasons: list[tuple[str, int]],
    language: str | None,
    options: TvtimeImportOptions,
    report: dict[str, Any],
    records: Any,
    progress_callback: Callable[[dict[str, Any], dict[str, Any]], None] | None,
    provider_factory: Callable[[], ImportProvider] | None,
) -> dict[tuple[str, int], AnimeMetaInfo]:
    anime_by_season: dict[tuple[str, int], AnimeMetaInfo] = {}
    details_by_season: dict[tuple[str, int], ImportAnimeDetail] = {}
    missing: list[tuple[str, int, str]] = []
    processed = 0

    for series_id, season_number in seasons:
        external_id = build_external_id(series_id, season_number)
        anime = session.scalar(
            select(AnimeMetaInfo).where(
                AnimeMetaInfo.provider_type == provider.name,
                AnimeMetaInfo.external_id == external_id,
            ),
        )
        if anime is None:
            missing.append((series_id, season_number, external_id))
            continue
        anime_by_season[series_id, season_number] = anime

    total = _metadata_total(seasons, missing)
    processed = len(anime_by_season)
    report['progress'] = _progress('importing_metadata', processed, total, 'Importing provider metadata')
    _notify_progress(report, progress_callback)
    workers = min(max(options.tvdb_workers, 1), 5, max(len(missing), 1))
    if missing:
        if workers <= 1:
            for series_id, season_number, external_id in missing:
                try:
                    details_by_season[series_id, season_number] = _fetch_detail(provider_factory or (lambda: provider), external_id, language)
                except (ImportProviderResponseError, ImportProviderTimeoutError, RuntimeError, ValueError, KeyError, TypeError) as exc:
                    _record_provider_failure(report, records, series_id, season_number, external_id, exc)
                processed += 1
                report['progress'] = _progress('importing_metadata', processed, total, 'Fetching provider metadata')
                _notify_progress(report, progress_callback)
        else:
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {
                    executor.submit(_fetch_detail, provider_factory or (lambda: provider), external_id, language): (series_id, season_number, external_id)
                    for series_id, season_number, external_id in missing
                }
                for future in as_completed(futures):
                    series_id, season_number, external_id = futures[future]
                    try:
                        details_by_season[series_id, season_number] = future.result()
                    except (ImportProviderResponseError, ImportProviderTimeoutError, RuntimeError, ValueError, KeyError, TypeError) as exc:
                        _record_provider_failure(report, records, series_id, season_number, external_id, exc)
                    processed += 1
                    report['progress'] = _progress('importing_metadata', processed, total, 'Fetching provider metadata')
                    _notify_progress(report, progress_callback)

    for series_id, season_number in seasons:
        if (series_id, season_number) in anime_by_season:
            continue
        detail = details_by_season.get((series_id, season_number))
        if detail is None:
            continue
        try:
            anime = AnimeMetaInfo(provider_type=detail.provider, external_id=detail.external_id, original_name=detail.title)
            session.add(anime)
            session.flush()
            populate_anime_from_detail(session, anime, detail)
        except (RuntimeError, ValueError, KeyError, TypeError) as exc:
            _record_provider_failure(report, records, series_id, season_number, detail.external_id, exc)
            continue
        anime_by_season[series_id, season_number] = anime
        report['summary']['importedAnime'] += 1
        processed += 1
        report['progress'] = _progress('importing_metadata', processed, total, 'Writing provider metadata')
        _notify_progress(report, progress_callback)
    return anime_by_season


def _metadata_total(seasons: list[tuple[str, int]], missing: list[tuple[str, int, str]]) -> int:
    return len(seasons) + len(missing)


def _fetch_detail(provider_factory: Callable[[], ImportProvider], external_id: str, language: str | None) -> ImportAnimeDetail:
    return provider_factory().get_anime_detail(external_id, language=language)


def _record_provider_failure(
    report: dict[str, Any],
    records: Any,
    series_id: str,
    season_number: int,
    external_id: str,
    exc: Exception,
) -> None:
    if season_number == 0:
        affected = [record for record in records if record.series_id == series_id and record.season_number == season_number]
        for record in affected:
            _add_unresolved(
                report,
                'unsupported_special_season',
                record.source_file,
                record.source_row,
                series_id=record.series_id,
                series_name=record.series_name,
                season_number=record.season_number,
                episode_number=record.episode_number,
                raw=record.raw,
            )
    report['providerFailures'].append(
        {
            'externalId': external_id,
            'errorType': type(exc).__name__,
            'message': str(exc),
            'sourceRows': _source_rows_for_season(records, series_id, season_number),
        },
    )
    report['summary']['providerFailures'] += 1


def _get_or_create_anime_progress(session: Session, *, user_id: int, anime_id: int) -> UserAnimeProgress:
    progress = session.scalar(select(UserAnimeProgress).where(UserAnimeProgress.user_id == user_id, UserAnimeProgress.anime_id == anime_id))
    if progress is None:
        progress = UserAnimeProgress(user_id=user_id, anime_id=anime_id, status=UserAnimeStatus.PLAN_TO_WATCH, last_watched_episode_number=0)
        session.add(progress)
        session.flush()
    return progress


def _ensure_library_progress(session: Session, user_id: int, anime_items: Any, touched_progress: set[int], report: dict[str, Any]) -> None:
    for anime in anime_items:
        progress = _get_or_create_anime_progress(session, user_id=user_id, anime_id=anime.id)
        if progress.id in touched_progress:
            continue
        if progress.status == UserAnimeStatus.PLAN_TO_WATCH:
            report['summary']['libraryEntriesImported'] += 1


def _season_numbers_for_library_series(provider: ImportProvider, series_id: str) -> list[int]:
    provider_any: Any = provider
    if hasattr(provider, 'get_series_season_numbers'):
        values = provider_any.get_series_season_numbers(series_id)
        return sorted({value for value in values if isinstance(value, int) and value >= 0})
    try:
        series = provider_any._get_series_extended(series_id)  # noqa: SLF001 - TVDB provider has no public season-list API yet.
        seasons = provider_any._aired_seasons(series)  # noqa: SLF001
    except (AttributeError, ImportProviderResponseError, ImportProviderTimeoutError, RuntimeError, ValueError, KeyError, TypeError):
        return []
    numbers: set[int] = set()
    for season in seasons:
        if isinstance(season, dict):
            number = coerce_int(season.get('number'))
            if number is not None and number >= 0:
                numbers.add(number)
    return sorted(numbers)


def _read_csv_files(files: dict[str, bytes]) -> dict[str, list[tuple[int, dict[str, str]]]]:
    parsed: dict[str, list[tuple[int, dict[str, str]]]] = {}
    for filename, content in files.items():
        if filename not in EXPECTED_CSV_FILES:
            continue
        text = content.decode('utf-8-sig', errors='replace')
        reader = csv.DictReader(io.StringIO(text))
        parsed[filename] = [(index, {key: value or '' for key, value in row.items() if key is not None}) for index, row in enumerate(reader, start=2)]
    return parsed


def _build_name_mapping(files: dict[str, bytes]) -> dict[str, set[str]]:
    mapping: dict[str, set[str]] = {}
    for _filename, rows in _read_csv_files(files).items():
        for _row_number, row in rows:
            series_id = _clean(row.get('s_id') or row.get('tv_show_id'))
            name = _clean(row.get('series_name') or row.get('tv_show_name'))
            if series_id and name:
                mapping.setdefault(_normalize_name(name), set()).add(series_id)
    return mapping


def _unique_series_id(name: str | None, mapping: dict[str, set[str]]) -> str | None:
    if not name:
        return None
    ids = mapping.get(_normalize_name(name), set())
    return next(iter(ids)) if len(ids) == 1 else None


def _add_unresolved_from_row(report: dict[str, Any], filename: str, row_number: int, row: dict[str, str], *, series_id: str | None = None, series_name: str | None = None) -> None:
    reason = 'missing_or_ambiguous_season'
    if _parse_int(row.get('episode_number') or row.get('ep_no')) is None:
        reason = 'missing_episode_number'
    _add_unresolved(report, reason, filename, row_number, series_id=series_id or _clean(row.get('s_id')), series_name=series_name or _clean(row.get('series_name')), season_number=_parse_int(row.get('season_number') or row.get('s_no') or row.get('episode_season_number')), episode_number=_parse_int(row.get('episode_number') or row.get('ep_no')), raw=row)


def _add_unresolved(
    report: dict[str, Any],
    reason: str,
    source_file: str,
    source_row: int,
    *,
    series_id: str | None = None,
    series_name: str | None = None,
    season_number: int | None = None,
    episode_number: int | None = None,
    raw: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    item = {
        'reason': reason,
        'sourceFile': source_file,
        'sourceRow': source_row,
        'seriesId': series_id,
        'seriesName': series_name,
        'seasonNumber': season_number,
        'episodeNumber': episode_number,
        'raw': raw or {},
    }
    if extra:
        item.update(extra)
    report['unresolved'].append(item)


def _record_context(record: WatchRecord, *, reason: str) -> dict[str, Any]:
    return {
        'reason': reason,
        'sourceFile': record.source_file,
        'sourceRow': record.source_row,
        'seriesId': record.series_id,
        'seriesName': record.series_name,
        'seasonNumber': record.season_number,
        'episodeNumber': record.episode_number,
        'watchedAt': record.watched_at.isoformat() if record.watched_at else None,
        'raw': record.raw,
    }


def _source_rows_for_season(records: Any, series_id: str, season_number: int) -> list[dict[str, Any]]:
    return [
        {'sourceFile': record.source_file, 'sourceRow': record.source_row, 'episodeNumber': record.episode_number}
        for record in records
        if record.series_id == series_id and record.season_number == season_number
    ]


def _new_report(user: User, options: TvtimeImportOptions) -> dict[str, Any]:
    return {
        'summary': {
            'parsedRecords': 0,
            'uniqueWatchedRecords': 0,
            'animeSeasonsQueued': 0,
            'importedAnime': 0,
            'importedEpisodeProgress': 0,
            'updatedEpisodeProgress': 0,
            'skippedDuplicates': 0,
            'providerFailures': 0,
            'unresolvedRecords': 0,
            'extraWatchEvents': 0,
            'existingDataPreserved': 0,
            'libraryEntriesImported': 0,
        },
        'progress': _progress('parsing', 0, 1, 'Parsing TV Time data'),
        'backend': options.backend,
        'languagePreference': user.language_preference,
        'dryRun': options.dry_run,
        'tvdbWorkers': options.tvdb_workers,
        'unresolved': [],
        'providerFailures': [],
        'relatedAnimeWarnings': [],
        'extraWatchEvents': [],
        'warnings': [],
    }


def _progress(stage: str, processed: int, total: int, message: str) -> dict[str, Any]:
    percent = 100 if total <= 0 else round((processed / total) * 100)
    return {'stage': stage, 'processed': processed, 'total': total, 'percent': percent, 'message': message}


def _notify_progress(report: dict[str, Any], callback: Callable[[dict[str, Any], dict[str, Any]], None] | None) -> None:
    if callback is not None:
        callback(report['progress'], report['summary'])


def _parse_int(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    try:
        return int(value.strip())
    except ValueError:
        return None


def _parse_bool(value: str | None) -> bool:
    return isinstance(value, str) and value.strip().lower() in {'1', 'true', 'yes', 'y'}


def _parse_datetime(value: str | None) -> datetime | None:
    if value is None or not value.strip():
        return None
    text = value.strip().replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _clean(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _normalize_name(value: str) -> str:
    return value.strip().casefold()


def _is_earlier(candidate: datetime | None, current: datetime | None) -> bool:
    return candidate is not None and (current is None or candidate < current)
