from __future__ import annotations

import signal
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy import func, not_, select
from sqlalchemy.orm import Session, selectinload

from app.api.utils.auth import require_auth_user
from app.api.utils.library import (
    TRACKING_LIST_RECENT_DAYS,
    build_navigation_anchors,
    get_search_library_markers,
    library_search_condition,
    sort_library_progresses,
    sort_library_search_progresses,
)
from app.api.utils.parsing import (
    parse_library_limit,
    parse_library_list_filter,
    parse_library_offset,
    parse_library_order,
    parse_library_season_zero_filter,
    parse_library_sort,
    parse_library_status,
    parse_search_limit,
    parse_search_offset,
    total_pages,
)
from app.api.utils.providers import get_import_provider_factory
from app.api.utils.serializers import (
    select_anime_name_for_user,
    serialize_anime,
    serialize_anime_name,
    serialize_duplicate_anime_candidate,
    serialize_import_search_result,
    serialize_library_progress,
    serialize_progress,
    serialize_summary,
)
from app.import_provider.exceptions import (
    ImportProviderResponseError,
    ImportProviderTimeoutError,
)
from app.import_provider.types import ProviderType
from app.models.anime import (
    AnimeMetaInfo,
    AnimeName,
    AnimeRelation,
    AnimeSummary,
    Episode,
)
from app.models.anime_utils import season_zero_anime_condition, tracking_list_query_parts
from app.models.progress import (
    UserAnimeProgress,
    UserAnimeRelationOverride,
    UserAnimeStatus,
    UserEpisodeProgress,
)
from app.models.user import User
from app.services.anime_library import (
    DuplicateAnimeConflict,
    add_anime_to_user_library,
    get_user_progress,
    set_anime_name_preference,
    set_summary_preference,
    switch_user_anime_provider,
    update_user_anime_status,
)
from app.services.anime_poster import enqueue_poster_download
from app.services.anime_sync import (
    serialize_episode_conflict,
    sync_anime_from_provider,
)
from app.services.library_refresh_jobs import (
    acquire_library_refresh_lock,
    current_library_refresh_job,
    current_user_job,
    load_library_refresh_job,
    release_library_refresh_lock,
    store_library_refresh_job,
)
from app.tasks.anime_sync import refresh_user_library

anime_info_bp = Blueprint("anime_info", __name__)

RELATED_ANIME_DISCOVERY_BY_PROVIDER = {
    'bangumi': {
        'enabled_config': 'AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED',
        'disabled_message': 'Bangumi related anime auto import is disabled',
    },
    'tvdb': {
        'enabled_config': 'AUTO_IMPORT_TVDB_SEASONS_ENABLED',
        'disabled_message': 'TVDB season auto import is disabled',
    },
}


@contextmanager
def provider_search_deadline(seconds: float) -> Iterator[None]:
    if seconds <= 0 or threading.current_thread() is not threading.main_thread() or not hasattr(signal, 'SIGALRM'):
        yield
        return

    previous_handler = signal.getsignal(signal.SIGALRM)

    def timeout_handler(_signum: int, _frame: object) -> None:
        message = 'Import provider request timed out'
        raise ImportProviderTimeoutError(message)

    signal.signal(signal.SIGALRM, timeout_handler)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            signal.setitimer(signal.ITIMER_REAL, *previous_timer)


@anime_info_bp.get('/search')
@require_auth_user
def search_anime(db: Session, user: User) -> ResponseReturnValue:
    keyword = request.args.get('q', '').strip()
    if not keyword:
        return jsonify({'message': 'Search keyword is required'}), 400

    limit, error = parse_search_limit(request.args.get('limit'))
    if error is not None:
        return jsonify({'message': error}), 400

    offset, error = parse_search_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400

    provider_name = request.args.get('provider', 'bangumi')
    factory = get_import_provider_factory()

    try:
        provider = factory.get_provider(provider_name)
        with provider_search_deadline(float(current_app.config['IMPORT_SEARCH_TIMEOUT'])):
            page = provider.search_anime(keyword, limit=limit, offset=offset, language=user.language_preference)
    except ImportProviderTimeoutError:
        return jsonify({'message': 'Import provider request timed out'}), 504
    except ImportProviderResponseError:
        return jsonify({'message': 'Import provider response error'}), 502

    markers = get_search_library_markers(db, user_id=user.id, results=page.results)
    return jsonify(
        {
            'total': page.total,
            'limit': page.limit,
            'offset': page.offset,
            'results': [
                serialize_import_search_result(
                    result,
                    anime_id=markers[result.provider, result.external_id][0],
                    library_status=markers[result.provider, result.external_id][1],
                )
                for result in page.results
            ],
        },
    )


@anime_info_bp.get('/providers')
@require_auth_user
def list_import_providers(_db: Session, _user: User) -> ResponseReturnValue:
    providers = get_import_provider_factory().list_providers()
    return jsonify(
        {
            'providers': [
                {'name': provider.name, 'label': _provider_label(provider.name)}
                for provider in providers
            ],
        },
    )


@anime_info_bp.post('/library')
@require_auth_user
def add_to_library(db: Session, user: User) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'message': 'Request body must be a JSON object'}), 400
    provider_name = payload.get('provider')
    external_id = payload.get('externalId')
    if not isinstance(provider_name, str) or not provider_name.strip():
        return jsonify({'message': 'Anime provider is required'}), 400
    if not isinstance(external_id, str) or not external_id.strip():
        return jsonify({'message': 'Anime externalId is required'}), 400
    provider_name = provider_name.strip()
    external_id = external_id.strip()
    duplicate_resolution = payload.get('duplicateResolution')
    if duplicate_resolution is not None and not isinstance(duplicate_resolution, dict):
        return jsonify({'message': 'duplicateResolution must be an object'}), 400
    try:
        provider_type = ProviderType(provider_name)
    except ValueError:
        return jsonify({'message': 'Unknown import provider'}), 400
    provider_name = provider_type.value

    try:
        provider = get_import_provider_factory().get_provider(provider_name)
        anime, progress, anime_created, library_changed, progress_created = add_anime_to_user_library(
            db,
            provider,
            user_id=user.id,
            external_id=external_id,
            duplicate_resolution=duplicate_resolution,
        )
    except DuplicateAnimeConflict as conflict:
        db.rollback()
        return jsonify(
            {
                'message': 'Potential duplicate anime found',
                'conflict': {
                    'provider': conflict.provider,
                    'externalId': conflict.external_id,
                    'title': conflict.title,
                    'candidates': [serialize_duplicate_anime_candidate(candidate) for candidate in conflict.candidates],
                },
            },
        ), 409
    except ValueError as exc:
        db.rollback()
        return jsonify({'message': str(exc)}), 400
    except ImportProviderTimeoutError:
        db.rollback()
        return jsonify({'message': 'Import provider request timed out'}), 504
    except ImportProviderResponseError:
        db.rollback()
        return jsonify({'message': 'Import provider response error'}), 502

    status_code = 201 if progress_created else 200
    return jsonify(
        {
            'anime': serialize_anime(anime, progress, user),
            'progress': serialize_progress(progress),
            'animeCreated': anime_created,
            'libraryEntryCreatedOrRestored': library_changed,
        },
    ), status_code


@anime_info_bp.post('/library/<int:anime_id>/provider-switch')
@require_auth_user
def switch_library_anime_provider(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'message': 'Request body must be a JSON object'}), 400
    provider_name = payload.get('provider')
    external_id = payload.get('externalId')
    if not isinstance(provider_name, str) or not provider_name.strip():
        return jsonify({'message': 'Anime provider is required'}), 400
    if not isinstance(external_id, str) or not external_id.strip():
        return jsonify({'message': 'Anime externalId is required'}), 400
    try:
        provider_type = ProviderType(provider_name.strip())
    except ValueError:
        return jsonify({'message': 'Unknown import provider'}), 400

    try:
        provider = get_import_provider_factory().get_provider(provider_type.value)
        result = switch_user_anime_provider(
            db,
            provider,
            user_id=user.id,
            anime_id=anime_id,
            external_id=external_id.strip(),
        )
        if result is None:
            db.rollback()
            return jsonify({'message': 'Anime not found'}), 404
    except ImportProviderTimeoutError:
        db.rollback()
        return jsonify({'message': 'Import provider request timed out'}), 504
    except ImportProviderResponseError:
        db.rollback()
        return jsonify({'message': 'Import provider response error'}), 502

    return jsonify(
        {
            'anime': serialize_anime(result.anime, result.progress, user),
            'progress': serialize_progress(result.progress, include_anime_id=True),
            'previousAnimeId': result.previous_anime_id,
            'episodeConflicts': [serialize_episode_conflict(conflict) for conflict in result.episode_conflicts],
        },
    )


def _provider_label(name: str) -> str:
    labels = {'bangumi': 'Bangumi', 'tmdb': 'TMDB', 'tvdb': 'The TVDB'}
    return labels.get(name, name)


@anime_info_bp.get('/library')
@require_auth_user
def list_library(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    status, error = parse_library_status(request.args.get('status'))
    if error is not None:
        return jsonify({'message': error}), 400
    sort, error = parse_library_sort(request.args.get('sort'))
    if error is not None:
        return jsonify({'message': error}), 400
    order, error = parse_library_order(request.args.get('order'))
    if error is not None:
        return jsonify({'message': error}), 400
    list_filter, error = parse_library_list_filter(request.args.get('list'))
    if error is not None:
        return jsonify({'message': error}), 400
    season_zero, error = parse_library_season_zero_filter(request.args.get('seasonZero'))
    if error is not None:
        return jsonify({'message': error}), 400
    keyword = request.args.get('q', '').strip()
    provider = request.args.get('provider', '').strip()

    stmt = (
        select(UserAnimeProgress)
        .options(
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.summaries),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.episodes),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.posters),
        )
        .join(UserAnimeProgress.anime)
        .where(
            UserAnimeProgress.user_id == user.id,
        )
    )

    if status is None:
        stmt = stmt.where(UserAnimeProgress.status != UserAnimeStatus.DROPPED)
    else:
        stmt = stmt.where(UserAnimeProgress.status == status)
    if keyword:
        stmt = stmt.where(library_search_condition(keyword))
    if list_filter != 'all':
        query_parts = tracking_list_query_parts(
            user_id=user.id,
            now=datetime.now(UTC),
            recent_days=TRACKING_LIST_RECENT_DAYS,
        )
        section_condition = query_parts['tracking_condition'] if list_filter == 'tracking' else ~query_parts['tracking_condition']
        stmt = stmt.join(
            query_parts['next_episode_subquery'],
            query_parts['next_episode_subquery'].c.anime_id == AnimeMetaInfo.id,
        ).join(
            query_parts['episode_stats_subquery'],
            query_parts['episode_stats_subquery'].c.anime_id == AnimeMetaInfo.id,
        ).where(section_condition)
    season_zero_condition = season_zero_anime_condition(AnimeMetaInfo)
    if season_zero == 'exclude':
        stmt = stmt.where(not_(season_zero_condition))
    elif season_zero == 'only':
        stmt = stmt.where(season_zero_condition)

    loaded_progresses = db.scalars(stmt).all()
    all_matching_progresses = (
        sort_library_search_progresses(loaded_progresses, keyword=keyword, sort=sort, order=order, user=user)
        if keyword
        else sort_library_progresses(loaded_progresses, sort=sort, order=order, user=user)
    )
    provider_options = sorted({progress.anime.provider_type for progress in all_matching_progresses})
    if provider:
        all_progresses = [
            progress
            for progress in all_matching_progresses
            if progress.anime.provider_type == provider
        ]
    else:
        all_progresses = all_matching_progresses
    total = len(all_progresses)
    progresses = all_progresses[offset : offset + limit]
    anime_ids = [progress.anime_id for progress in progresses]
    watched_counts = dict.fromkeys(anime_ids, 0)
    if anime_ids:
        watched_count_rows = db.execute(
            select(Episode.anime_id, func.count(UserEpisodeProgress.id))
            .join(UserEpisodeProgress, UserEpisodeProgress.episode_id == Episode.id)
            .where(
                Episode.anime_id.in_(anime_ids),
                UserEpisodeProgress.user_id == user.id,
                UserEpisodeProgress.watched.is_(True),
            )
            .group_by(Episode.anime_id),
        ).all()
        for anime_id, count in watched_count_rows:
            watched_counts[anime_id] = count
    return jsonify(
        {
            'total': total,
            'limit': limit,
            'offset': offset,
            'page': offset // limit + 1,
            'totalPages': total_pages(total, limit),
            'sort': sort,
            'order': order,
            'providers': [
                {'name': item, 'label': _provider_label(item)}
                for item in provider_options
            ],
            'navigationAnchors': build_navigation_anchors(all_progresses, sort=sort, limit=limit, user=user),
            'items': [
                {
                    'anime': serialize_anime(progress.anime, progress, user),
                    'progress': serialize_library_progress(
                        progress,
                        watched_episode_count=watched_counts[progress.anime_id],
                        total_episode_count=progress.anime.total_episodes or len(progress.anime.episodes) or None,
                    ),
                }
                for progress in progresses
            ],
        },
    )


@anime_info_bp.post('/library/<int:anime_id>/sync')
@require_auth_user
def sync_library_anime(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    anime = db.get(AnimeMetaInfo, anime_id)
    if anime is None:
        return jsonify({'message': 'Anime not found'}), 404

    try:
        provider = get_import_provider_factory().get_provider(anime.provider_type)
        result = sync_anime_from_provider(db, provider, anime_id=anime_id, user_id=user.id)
        if result is None:
            db.rollback()
            return jsonify({'message': 'Anime not found'}), 404
        db.commit()
    except ImportProviderTimeoutError:
        db.rollback()
        return jsonify({'message': 'Import provider request timed out'}), 504
    except ImportProviderResponseError:
        db.rollback()
        return jsonify({'message': 'Import provider response error'}), 502
    except Exception:
        db.rollback()
        raise

    for poster_id in result.poster_ids_to_enqueue:
        enqueue_poster_download(poster_id)
    db.refresh(result.anime)
    db.refresh(progress)
    return jsonify(
        {
            'anime': serialize_anime(result.anime, progress, user),
            'progress': serialize_progress(progress),
            'synced': True,
            'episodeConflicts': [serialize_episode_conflict(conflict) for conflict in result.episode_conflicts],
        },
    )


@anime_info_bp.post('/library/<int:anime_id>/discover-related-anime')
@require_auth_user
def discover_library_related_anime(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    anime = db.get(AnimeMetaInfo, anime_id)
    if anime is None:
        return jsonify({'message': 'Anime not found'}), 404
    discovery_config = RELATED_ANIME_DISCOVERY_BY_PROVIDER.get(anime.provider_type)
    if discovery_config is None:
        return jsonify({'message': 'Related anime discovery is not supported for this provider'}), 400
    if not current_app.config.get(str(discovery_config['enabled_config'])):
        return jsonify({'message': discovery_config['disabled_message']}), 403

    task_id = uuid4().hex
    job_dir = str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR'])
    progress_payload = _library_refresh_progress('queued', 0, 1, 'Related anime discovery queued')
    store_library_refresh_job(
        job_dir,
        task_id,
        {
            'jobId': task_id,
            'userId': user.id,
            'animeId': anime_id,
            'kind': 'related_anime_discovery',
            'status': 'queued',
            'progress': progress_payload,
            'summary': None,
        },
    )
    try:
        from app.tasks.related_anime_discovery import discover_related_anime_for_library_anime

        task = discover_related_anime_for_library_anime.apply_async(args=(user.id, anime_id, job_dir, task_id), task_id=task_id)
    except Exception:
        raise
    return jsonify({'queued': True, 'taskId': task.id, 'job': _library_refresh_job_response(load_library_refresh_job(job_dir, task.id))}), 202


@anime_info_bp.get('/library/<int:anime_id>/discover-related-anime/<job_id>')
@require_auth_user
def get_related_anime_discovery_job(_db: Session, user: User, anime_id: int, job_id: str) -> ResponseReturnValue:
    job = load_library_refresh_job(str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR']), job_id)
    if job is None or job.get('userId') != user.id or job.get('animeId') != anime_id or job.get('kind') != 'related_anime_discovery':
        return jsonify({'message': 'Related anime discovery job not found'}), 404
    return jsonify(_library_refresh_job_response(job))


@anime_info_bp.get('/library/<int:anime_id>/discover-related-anime')
@require_auth_user
def get_current_related_anime_discovery_job(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    job = current_user_job(
        str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR']),
        user_id=user.id,
        anime_id=anime_id,
        kind='related_anime_discovery',
    )
    return jsonify({'job': _library_refresh_job_response(job)})


@anime_info_bp.post('/library/sync-all')
@require_auth_user
def sync_all_library_anime(_db: Session, user: User) -> ResponseReturnValue:
    task_id = uuid4().hex
    job_dir = str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR'])
    lock = acquire_library_refresh_lock(
        user_id=user.id,
        task_id=task_id,
        lock_dir=job_dir,
    )
    if not lock.acquired:
        job = load_library_refresh_job(job_dir, lock.task_id)
        return jsonify({'queued': False, 'taskId': lock.task_id, 'job': _library_refresh_job_response(job)}), 202
    progress = _library_refresh_progress('queued', 0, 1, 'Library refresh queued')
    store_library_refresh_job(
        job_dir,
        task_id,
        {'jobId': task_id, 'userId': user.id, 'status': 'queued', 'progress': progress, 'summary': None},
    )
    try:
        task = refresh_user_library.apply_async(args=(user.id, lock.lock_path, job_dir, task_id), task_id=task_id)
    except Exception:
        release_library_refresh_lock(lock.lock_path)
        raise
    return jsonify({'queued': True, 'taskId': task.id, 'job': _library_refresh_job_response(load_library_refresh_job(job_dir, task.id))}), 202


@anime_info_bp.get('/library/sync-all')
@require_auth_user
def get_current_library_refresh(_db: Session, user: User) -> ResponseReturnValue:
    job = current_library_refresh_job(str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR']), user.id)
    return jsonify({'job': _library_refresh_job_response(job)})


@anime_info_bp.get('/library/sync-all/<job_id>')
@require_auth_user
def get_library_refresh(_db: Session, user: User, job_id: str) -> ResponseReturnValue:
    job = load_library_refresh_job(str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR']), job_id)
    if job is None or job.get('userId') != user.id:
        return jsonify({'message': 'Library refresh job not found'}), 404
    return jsonify(_library_refresh_job_response(job))


def _library_refresh_progress(stage: str, processed: int, total: int, message: str) -> dict[str, object]:
    percent = round(processed / total * 100) if total > 0 else 0
    return {'stage': stage, 'processed': processed, 'total': total, 'percent': percent, 'message': message}


def _library_refresh_job_response(job: dict[str, object] | None) -> dict[str, object] | None:
    if job is None:
        return None
    return {
        'jobId': job.get('jobId'),
        'status': job.get('status'),
        'progress': job.get('progress'),
        'summary': job.get('summary'),
    }


@anime_info_bp.get('/<int:anime_id>')
@require_auth_user
def get_anime_detail(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    anime = db.scalar(
        select(AnimeMetaInfo)
        .options(
            selectinload(AnimeMetaInfo.summaries),
            selectinload(AnimeMetaInfo.names),
            selectinload(AnimeMetaInfo.episodes),
            selectinload(AnimeMetaInfo.posters),
            selectinload(AnimeMetaInfo.related_anime).selectinload(AnimeRelation.poster),
        )
        .where(AnimeMetaInfo.id == anime_id),
    )
    if anime is None:
        return jsonify({'message': 'Anime not found'}), 404
    related_anime_ids = [relation.related_anime_id for relation in anime.related_anime if relation.related_anime_id is not None]
    relation_ids = [relation.id for relation in anime.related_anime]
    related_anime_overrides = {}
    if relation_ids:
        overrides = db.scalars(
            select(UserAnimeRelationOverride)
            .options(selectinload(UserAnimeRelationOverride.related_anime).selectinload(AnimeMetaInfo.posters))
            .where(
                UserAnimeRelationOverride.user_id == user.id,
                UserAnimeRelationOverride.anime_relation_id.in_(relation_ids),
            ),
        ).all()
        related_anime_overrides = {override.anime_relation_id: override.related_anime for override in overrides}
        related_anime_ids.extend(override.related_anime_id for override in overrides)
    related_library_anime_ids = set()
    related_anime_progresses = {}
    if related_anime_ids:
        related_progresses = db.scalars(
            select(UserAnimeProgress)
            .options(selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.names))
            .where(
                UserAnimeProgress.user_id == user.id,
                UserAnimeProgress.anime_id.in_(related_anime_ids),
            ),
        ).all()
        related_anime_progresses = {progress.anime_id: progress for progress in related_progresses}
        related_library_anime_ids = set(related_anime_progresses)
    return jsonify(
        {
            'anime': serialize_anime(
                anime,
                progress,
                user,
                include_available_summaries=True,
                include_available_names=True,
                include_available_posters=True,
                include_related_anime=True,
                related_library_anime_ids=related_library_anime_ids,
                related_anime_overrides=related_anime_overrides,
                related_anime_progresses=related_anime_progresses,
            ),
            'progress': serialize_progress(progress),
            'features': {
                'seasonDiscovery': _season_discovery_enabled(anime.provider_type),
            },
        },
    )


def _season_discovery_enabled(provider_type: str) -> bool:
    discovery_config = RELATED_ANIME_DISCOVERY_BY_PROVIDER.get(provider_type)
    return bool(discovery_config is not None and current_app.config.get(str(discovery_config['enabled_config'])))


@anime_info_bp.patch('/library/<int:anime_id>/status')
@require_auth_user
def update_library_status(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get('status'), str):
        return jsonify({'message': 'Anime status is required'}), 400
    try:
        status = UserAnimeStatus(payload['status'])
    except ValueError:
        return jsonify({'message': 'Anime status is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    update_user_anime_status(db, progress=progress, status=status)
    return jsonify({'progress': serialize_progress(progress, include_anime_id=True)})


@anime_info_bp.patch('/library/<int:anime_id>/name-preference')
@require_auth_user
def update_anime_name_preference(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('nameId' not in payload):
        return jsonify({'message': 'nameId is required'}), 400
    name_id = payload['nameId']
    if name_id is not None and not isinstance(name_id, int):
        return jsonify({'message': 'nameId is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    if set_anime_name_preference(db, progress=progress, name_id=name_id) is None:
        return jsonify({'message': 'nameId is invalid'}), 400
    names = db.scalars(select(AnimeName).where(AnimeName.anime_id == anime_id).order_by(AnimeName.id)).all()
    selected = select_anime_name_for_user(names, progress, user)
    return jsonify(
        {
            'name': serialize_anime_name(selected),
            'progress': {'id': progress.id, 'animeId': anime_id, 'preferredNameId': progress.preferred_name_id},
        },
    )


@anime_info_bp.patch('/library/<int:anime_id>/summary-preference')
@require_auth_user
def update_summary_preference(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('summaryId' not in payload):
        return jsonify({'message': 'summaryId is required'}), 400
    summary_id = payload['summaryId']
    if summary_id is not None and not isinstance(summary_id, int):
        return jsonify({'message': 'summaryId is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    if set_summary_preference(db, progress=progress, summary_id=summary_id) is None:
        return jsonify({'message': 'summaryId is invalid'}), 400
    summaries = db.scalars(select(AnimeSummary).where(AnimeSummary.anime_id == anime_id).order_by(AnimeSummary.id)).all()
    selected = next((summary for summary in summaries if summary.id == summary_id), None) if summary_id is not None else None
    if selected is None and summaries:
        selected = summaries[0]
    return jsonify(
        {
            'summary': serialize_summary(selected, progress),
            'progress': {'id': progress.id, 'animeId': anime_id, 'preferredSummaryId': progress.preferred_summary_id},
        },
    )
