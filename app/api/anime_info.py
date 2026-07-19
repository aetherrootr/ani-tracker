from __future__ import annotations

import signal
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from operator import itemgetter
from typing import Any
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy import func, not_, select
from sqlalchemy.orm import Session, selectinload

from app.api.utils.auth import require_auth_user
from app.api.utils.library import (
    build_navigation_anchors,
    get_search_library_markers,
    library_search_condition,
    sort_library_progresses,
    sort_library_search_progresses,
)
from app.api.utils.parsing import (
    parse_library_air_status_filter,
    parse_library_limit,
    parse_library_offset,
    parse_library_order,
    parse_library_season_zero_filter,
    parse_library_sort,
    parse_library_status,
    parse_library_unwatched_filter,
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
    serialize_metadata_snapshot,
    serialize_progress,
    serialize_related_anime,
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
from app.models.anime_utils import library_filter_conditions, season_zero_anime_condition
from app.models.progress import (
    UserAnimeMetadataSource,
    UserAnimeProgress,
    UserAnimeRelationDeletionPrompt,
    UserAnimeRelationOverride,
    UserAnimeStatus,
    UserEpisodeProgress,
    UserManualAnimeRelation,
)
from app.models.user import User
from app.services.anime_library import (
    DuplicateAnimeConflict,
    _fallback_related_relations,
    add_anime_to_user_library,
    get_metadata_snapshot,
    get_user_progress,
    preview_user_anime_provider_switch,
    set_anime_metadata_source,
    set_anime_name_preference,
    set_summary_preference,
    switch_user_anime_provider,
    update_user_anime_status,
)
from app.services.anime_poster import enqueue_poster_download
from app.services.anime_sync import (
    get_episode_conflicts,
    serialize_episode_conflict,
    sync_anime_from_provider,
)
from app.services.library_refresh_jobs import (
    acquire_library_refresh_lock,
    current_job_by_kind,
    current_library_refresh_job,
    current_user_job,
    load_library_refresh_job,
    release_library_refresh_lock,
    store_library_refresh_job,
)
from app.tasks.anime_sync import refresh_airing_anime, refresh_user_library

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
AIRING_SYNC_LOCK_USER_ID = 0


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


@anime_info_bp.get('/tvdb/seasons')
@require_auth_user
def get_tvdb_seasons(db: Session, user: User) -> ResponseReturnValue:
    external_id = request.args.get('externalId', '').strip()
    if not external_id:
        return jsonify({'message': 'Anime externalId is required'}), 400

    try:
        provider = get_import_provider_factory().get_provider('tvdb')
        get_series_seasons = getattr(provider, 'get_series_seasons', None)
        if not callable(get_series_seasons):
            return jsonify({'message': 'TVDB provider does not support season discovery'}), 400
        with provider_search_deadline(float(current_app.config['IMPORT_SEARCH_TIMEOUT'])):
            results = get_series_seasons(external_id, language=user.language_preference)
    except ValueError as exc:
        return jsonify({'message': str(exc)}), 400
    except ImportProviderTimeoutError:
        return jsonify({'message': 'Import provider request timed out'}), 504
    except ImportProviderResponseError:
        return jsonify({'message': 'Import provider response error'}), 502

    markers = get_search_library_markers(db, user_id=user.id, results=results)
    return jsonify(
        {
            'results': [
                serialize_import_search_result(
                    result,
                    anime_id=markers[result.provider, result.external_id][0],
                    library_status=markers[result.provider, result.external_id][1],
                )
                for result in results
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
    if provider_name.strip() == 'local':
        progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
        if progress is None:
            return jsonify({'message': 'Anime not found'}), 404
        try:
            set_anime_metadata_source(db, progress=progress, source=UserAnimeMetadataSource.LOCAL_SNAPSHOT.value)
        except ValueError as exc:
            db.rollback()
            return jsonify({'message': str(exc)}), 400
        anime = db.get(AnimeMetaInfo, anime_id)
        snapshot = get_metadata_snapshot(db, user_id=user.id, anime_id=anime_id)
        return jsonify(
            {
                'anime': serialize_anime(anime, progress, user) if anime is not None else None,
                'progress': serialize_progress(progress, include_anime_id=True, has_local_snapshot=snapshot is not None),
                'previousAnimeId': anime_id,
                'episodeConflicts': [],
                'metadataSnapshot': serialize_metadata_snapshot(snapshot),
            },
        )
    if not isinstance(external_id, str) or not external_id.strip():
        return jsonify({'message': 'Anime externalId is required'}), 400
    try:
        provider_type = ProviderType(provider_name.strip())
    except ValueError:
        return jsonify({'message': 'Unknown import provider'}), 400

    try:
        provider = get_import_provider_factory().get_provider(provider_type.value)
        confirmed = payload.get('confirm') is True
        if not confirmed:
            preview = preview_user_anime_provider_switch(
                db,
                provider,
                user_id=user.id,
                anime_id=anime_id,
                external_id=external_id.strip(),
            )
            if preview is None:
                db.rollback()
                return jsonify({'message': 'Anime not found'}), 404
            if preview.episode_conflicts:
                db.rollback()
                return jsonify(
                    {
                        'message': 'Provider switch has episode conflicts',
                        'anime': serialize_anime(preview.anime, preview.progress, user),
                        'progress': serialize_progress(preview.progress, include_anime_id=True, has_local_snapshot=get_metadata_snapshot(db, user_id=user.id, anime_id=anime_id) is not None),
                        'previousAnimeId': preview.previous_anime_id,
                        'episodeConflicts': [serialize_episode_conflict(conflict) for conflict in preview.episode_conflicts],
                    },
                ), 409
            db.rollback()
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
            'progress': serialize_progress(result.progress, include_anime_id=True, has_local_snapshot=get_metadata_snapshot(db, user_id=user.id, anime_id=result.progress.anime_id) is not None),
            'previousAnimeId': result.previous_anime_id,
            'episodeConflicts': [serialize_episode_conflict(conflict) for conflict in result.episode_conflicts],
            'autoMappedCount': result.related_auto_mapped_count,
            'manualMappingRequiredCount': result.related_manual_mapping_required_count,
        },
    )


@anime_info_bp.patch('/library/<int:anime_id>/metadata-source')
@require_auth_user
def update_library_anime_metadata_source(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get('source'), str):
        return jsonify({'message': 'Metadata source is required'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    anime = db.get(AnimeMetaInfo, anime_id)
    if progress is None or anime is None:
        return jsonify({'message': 'Anime not found'}), 404
    try:
        set_anime_metadata_source(db, progress=progress, source=payload['source'])
    except ValueError as exc:
        db.rollback()
        return jsonify({'message': str(exc)}), 400
    snapshot = get_metadata_snapshot(db, user_id=user.id, anime_id=anime_id)
    return jsonify(
        {
            'anime': serialize_anime(anime, progress, user),
            'progress': serialize_progress(progress, has_local_snapshot=snapshot is not None),
            'metadataSnapshot': serialize_metadata_snapshot(snapshot),
        },
    )


@anime_info_bp.get('/library/<int:anime_id>/metadata-snapshot')
@require_auth_user
def get_library_anime_metadata_snapshot(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    if get_user_progress(db, user_id=user.id, anime_id=anime_id) is None:
        return jsonify({'message': 'Anime not found'}), 404
    snapshot = get_metadata_snapshot(db, user_id=user.id, anime_id=anime_id)
    return jsonify({'metadataSnapshot': serialize_metadata_snapshot(snapshot, include_episodes=True)})


@anime_info_bp.patch('/library/<int:anime_id>/related-anime/<int:relation_id>/override')
@require_auth_user
def update_related_anime_override(db: Session, user: User, anime_id: int, relation_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('relatedAnimeId' not in payload and 'allowProviderImport' not in payload):
        return jsonify({'message': 'relatedAnimeId or allowProviderImport is required'}), 400
    related_anime_id = payload.get('relatedAnimeId')
    if related_anime_id is not None and not isinstance(related_anime_id, int):
        return jsonify({'message': 'relatedAnimeId is invalid'}), 400
    allow_provider_import = payload.get('allowProviderImport')
    if allow_provider_import is not None and not isinstance(allow_provider_import, bool):
        return jsonify({'message': 'allowProviderImport is invalid'}), 400
    if get_user_progress(db, user_id=user.id, anime_id=anime_id) is None:
        return jsonify({'message': 'Anime not found'}), 404
    relation = db.get(AnimeRelation, relation_id)
    if relation is None or not _relation_visible_to_user(db, user_id=user.id, anime_id=anime_id, relation=relation):
        return jsonify({'message': 'Related anime relation not found'}), 404
    if 'relatedAnimeId' in payload and related_anime_id is None:
        override = db.scalar(
            select(UserAnimeRelationOverride).where(
                UserAnimeRelationOverride.user_id == user.id,
                UserAnimeRelationOverride.anime_relation_id == relation_id,
            ),
        )
        if override is not None:
            db.delete(override)
        db.commit()
        return jsonify({'override': None})
    override = db.scalar(
        select(UserAnimeRelationOverride).where(
            UserAnimeRelationOverride.user_id == user.id,
            UserAnimeRelationOverride.anime_relation_id == relation_id,
        ),
    )
    if 'relatedAnimeId' in payload:
        if related_anime_id is None:
            return jsonify({'message': 'relatedAnimeId is invalid'}), 400
        if get_user_progress(db, user_id=user.id, anime_id=related_anime_id) is None:
            return jsonify({'message': 'relatedAnimeId is not in your library'}), 400
        if override is None:
            override = UserAnimeRelationOverride(user_id=user.id, anime_relation_id=relation_id, related_anime_id=related_anime_id)
            db.add(override)
        else:
            override.related_anime_id = related_anime_id
    elif override is None:
        return jsonify({'message': 'Override not found'}), 404
    if allow_provider_import is not None:
        override.allow_provider_import = allow_provider_import
    db.commit()
    return jsonify({'override': {'relationId': relation_id, 'relatedAnimeId': override.related_anime_id, 'allowProviderImport': override.allow_provider_import}})


@anime_info_bp.get('/library/<int:anime_id>/manual-related-anime')
@require_auth_user
def list_manual_related_anime(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    if get_user_progress(db, user_id=user.id, anime_id=anime_id) is None:
        return jsonify({'message': 'Anime not found'}), 404
    relations = _manual_relations_for_anime(db, user_id=user.id, anime_id=anime_id)
    return jsonify({'manualRelatedAnime': [_serialize_manual_relation_management_item(relation, current_anime_id=anime_id, user=user) for relation in relations]})


@anime_info_bp.post('/library/<int:anime_id>/manual-related-anime')
@require_auth_user
def create_manual_related_anime(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'message': 'Request body must be a JSON object'}), 400
    related_anime_id = payload.get('relatedAnimeId')
    if not isinstance(related_anime_id, int):
        return jsonify({'message': 'relatedAnimeId is required'}), 400
    relation_type = payload.get('relationType', 'same_series_manual')
    if not isinstance(relation_type, str) or not relation_type.strip():
        return jsonify({'message': 'relationType is invalid'}), 400
    note = payload.get('note')
    if note is not None and not isinstance(note, str):
        return jsonify({'message': 'note is invalid'}), 400
    if anime_id == related_anime_id:
        return jsonify({'message': 'relatedAnimeId must differ from animeId'}), 400
    if get_user_progress(db, user_id=user.id, anime_id=anime_id) is None or get_user_progress(db, user_id=user.id, anime_id=related_anime_id) is None:
        return jsonify({'message': 'Both anime must be in your library'}), 400
    low_id, high_id = sorted((anime_id, related_anime_id))
    relation = db.scalar(
        select(UserManualAnimeRelation).where(
            UserManualAnimeRelation.user_id == user.id,
            UserManualAnimeRelation.anime_id_low == low_id,
            UserManualAnimeRelation.anime_id_high == high_id,
            UserManualAnimeRelation.relation_type == relation_type.strip(),
        ),
    )
    if relation is None:
        relation = UserManualAnimeRelation(
            user_id=user.id,
            anime_id_low=low_id,
            anime_id_high=high_id,
            relation_type=relation_type.strip(),
            note=note.strip() if isinstance(note, str) else None,
        )
        db.add(relation)
    else:
        relation.note = note.strip() if isinstance(note, str) else relation.note
    db.commit()
    return jsonify({'manualRelation': _serialize_manual_relation_management_item(relation, current_anime_id=anime_id, user=user)}), 201


@anime_info_bp.patch('/library/<int:anime_id>/manual-related-anime/<int:manual_relation_id>')
@require_auth_user
def update_manual_related_anime(db: Session, user: User, anime_id: int, manual_relation_id: int) -> ResponseReturnValue:
    relation = _get_owned_manual_relation(db, user_id=user.id, anime_id=anime_id, manual_relation_id=manual_relation_id)
    if relation is None:
        return jsonify({'message': 'Manual related anime relation not found'}), 404
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'message': 'Request body must be a JSON object'}), 400
    note = payload.get('note')
    relation_type = payload.get('relationType')
    if note is not None:
        if not isinstance(note, str):
            return jsonify({'message': 'note is invalid'}), 400
        relation.note = note.strip() or None
    if relation_type is not None:
        if not isinstance(relation_type, str) or not relation_type.strip():
            return jsonify({'message': 'relationType is invalid'}), 400
        relation.relation_type = relation_type.strip()
    db.commit()
    return jsonify({'manualRelation': _serialize_manual_relation_management_item(relation, current_anime_id=anime_id, user=user)})


@anime_info_bp.delete('/library/<int:anime_id>/manual-related-anime/<int:manual_relation_id>')
@require_auth_user
def delete_manual_related_anime(db: Session, user: User, anime_id: int, manual_relation_id: int) -> ResponseReturnValue:
    relation = _get_owned_manual_relation(db, user_id=user.id, anime_id=anime_id, manual_relation_id=manual_relation_id)
    if relation is None:
        return jsonify({'message': 'Manual related anime relation not found'}), 404
    db.delete(relation)
    db.commit()
    return '', 204


@anime_info_bp.post('/library/<int:anime_id>/related-anime/deletion-prompts/<int:prompt_id>/keep')
@require_auth_user
def keep_deleted_related_anime(db: Session, user: User, anime_id: int, prompt_id: int) -> ResponseReturnValue:
    prompt = _get_owned_deletion_prompt(db, user_id=user.id, anime_id=anime_id, prompt_id=prompt_id)
    if prompt is None:
        return jsonify({'message': 'Deletion prompt not found'}), 404
    if prompt.status != 'pending':
        return jsonify({'message': 'Deletion prompt is already resolved'}), 409
    if prompt.related_anime_id is None or get_user_progress(db, user_id=user.id, anime_id=prompt.related_anime_id) is None:
        return jsonify({'message': 'Related anime is not in your library'}), 400
    if get_user_progress(db, user_id=user.id, anime_id=prompt.anime_id) is None:
        return jsonify({'message': 'Anime is not in your library'}), 400
    low_id, high_id = sorted((prompt.anime_id, prompt.related_anime_id))
    relation = db.scalar(
        select(UserManualAnimeRelation).where(
            UserManualAnimeRelation.user_id == user.id,
            UserManualAnimeRelation.anime_id_low == low_id,
            UserManualAnimeRelation.anime_id_high == high_id,
            UserManualAnimeRelation.relation_type == prompt.relation_type,
        ),
    )
    if relation is None:
        relation = UserManualAnimeRelation(
            user_id=user.id,
            anime_id_low=low_id,
            anime_id_high=high_id,
            relation_type=prompt.relation_type,
            created_from_anime_relation_id=prompt.anime_relation_id,
            created_from_provider=prompt.provider,
            created_from_external_id=prompt.external_id,
            snapshot_title=prompt.title,
            snapshot_air_date=prompt.air_date,
            snapshot_episode_count=prompt.episode_count,
        )
        db.add(relation)
    prompt.status = 'kept'
    db.commit()
    return jsonify({'manualRelation': _serialize_manual_relation_management_item(relation, current_anime_id=anime_id, user=user)})


@anime_info_bp.delete('/library/<int:anime_id>/related-anime/deletion-prompts/<int:prompt_id>')
@require_auth_user
def dismiss_deleted_related_anime(db: Session, user: User, anime_id: int, prompt_id: int) -> ResponseReturnValue:
    prompt = _get_owned_deletion_prompt(db, user_id=user.id, anime_id=anime_id, prompt_id=prompt_id)
    if prompt is None:
        return jsonify({'message': 'Deletion prompt not found'}), 404
    if prompt.status != 'pending':
        return '', 204
    prompt.status = 'dismissed'
    if prompt.anime_relation_id is not None:
        override = db.scalar(
            select(UserAnimeRelationOverride).where(
                UserAnimeRelationOverride.user_id == user.id,
                UserAnimeRelationOverride.anime_relation_id == prompt.anime_relation_id,
            ),
        )
        if override is not None:
            db.delete(override)
    db.commit()
    return '', 204


def _relation_visible_to_user(db: Session, *, user_id: int, anime_id: int, relation: AnimeRelation) -> bool:
    if relation.is_active and relation.anime_id == anime_id:
        return True
    reverse_override = db.scalar(
        select(UserAnimeRelationOverride.id).where(
            UserAnimeRelationOverride.user_id == user_id,
            UserAnimeRelationOverride.anime_relation_id == relation.id,
            UserAnimeRelationOverride.related_anime_id == anime_id,
        ),
    )
    if reverse_override is not None:
        return True
    return any(item.id == relation.id for item in _fallback_related_relations(db, user_id=user_id, anime_id=anime_id))


def _manual_relations_for_anime(db: Session, *, user_id: int, anime_id: int) -> list[UserManualAnimeRelation]:
    return list(db.scalars(
        select(UserManualAnimeRelation)
        .options(
            selectinload(UserManualAnimeRelation.anime_low).selectinload(AnimeMetaInfo.names),
            selectinload(UserManualAnimeRelation.anime_high).selectinload(AnimeMetaInfo.names),
        )
        .where(
            UserManualAnimeRelation.user_id == user_id,
            (UserManualAnimeRelation.anime_id_low == anime_id) | (UserManualAnimeRelation.anime_id_high == anime_id),
        )
        .order_by(UserManualAnimeRelation.id),
    ).all())


def _get_owned_manual_relation(db: Session, *, user_id: int, anime_id: int, manual_relation_id: int) -> UserManualAnimeRelation | None:
    relation = db.scalar(
        select(UserManualAnimeRelation).where(
            UserManualAnimeRelation.id == manual_relation_id,
            UserManualAnimeRelation.user_id == user_id,
            (UserManualAnimeRelation.anime_id_low == anime_id) | (UserManualAnimeRelation.anime_id_high == anime_id),
        ),
    )
    return relation


def _get_pending_deletion_prompt(db: Session, *, user_id: int, anime_id: int, prompt_id: int) -> UserAnimeRelationDeletionPrompt | None:
    return db.scalar(
        select(UserAnimeRelationDeletionPrompt).where(
            UserAnimeRelationDeletionPrompt.id == prompt_id,
            UserAnimeRelationDeletionPrompt.user_id == user_id,
            UserAnimeRelationDeletionPrompt.anime_id == anime_id,
            UserAnimeRelationDeletionPrompt.status == 'pending',
        ),
    )


def _get_owned_deletion_prompt(db: Session, *, user_id: int, anime_id: int, prompt_id: int) -> UserAnimeRelationDeletionPrompt | None:
    return db.scalar(
        select(UserAnimeRelationDeletionPrompt).where(
            UserAnimeRelationDeletionPrompt.id == prompt_id,
            UserAnimeRelationDeletionPrompt.user_id == user_id,
            (UserAnimeRelationDeletionPrompt.anime_id == anime_id) | (UserAnimeRelationDeletionPrompt.related_anime_id == anime_id),
        ),
    )


def _serialize_manual_relation_management_item(relation: UserManualAnimeRelation, *, current_anime_id: int, user: User) -> dict[str, object]:
    related_anime = relation.anime_high if relation.anime_id_low == current_anime_id else relation.anime_low
    selected_name = select_anime_name_for_user(sorted(related_anime.names, key=lambda item: item.id), UserAnimeProgress(user_id=user.id, anime_id=related_anime.id), user)
    return {
        'id': relation.id,
        'animeId': current_anime_id,
        'relatedAnimeId': related_anime.id,
        'relatedAnimeTitle': selected_name.name if selected_name is not None else related_anime.original_name,
        'relationType': relation.relation_type,
        'note': relation.note,
        'createdFromAnimeRelationId': relation.created_from_anime_relation_id,
    }


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
    unwatched_filter, error = parse_library_unwatched_filter(request.args.get('unwatched'))
    if error is not None:
        return jsonify({'message': error}), 400
    air_status_filter, error = parse_library_air_status_filter(request.args.get('airStatus'))
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
    if unwatched_filter != 'all' or air_status_filter != 'all':
        filter_conditions = library_filter_conditions(
            user_id=user.id,
            now=datetime.now(UTC),
        )
        if unwatched_filter != 'all':
            unwatched_condition = filter_conditions['has_unwatched_episode']
            stmt = stmt.where(unwatched_condition if unwatched_filter == 'yes' else ~unwatched_condition)
        if air_status_filter != 'all':
            condition_name = 'not_started' if air_status_filter == 'notStarted' else air_status_filter
            stmt = stmt.where(filter_conditions[condition_name])
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

    if progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        snapshot = get_metadata_snapshot(db, user_id=user.id, anime_id=anime_id)
        return jsonify(
            {
                'anime': serialize_anime(anime, progress, user),
                'progress': serialize_progress(progress, has_local_snapshot=snapshot is not None),
                'synced': False,
                'episodeConflicts': [],
            },
        )
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
            'progress': serialize_progress(progress, has_local_snapshot=get_metadata_snapshot(db, user_id=user.id, anime_id=anime_id) is not None),
            'synced': True,
            'episodeConflicts': [serialize_episode_conflict(conflict) for conflict in result.episode_conflicts],
        },
    )


@anime_info_bp.post('/airing/sync')
@require_auth_user
def queue_airing_anime_sync(_db: Session, _user: User) -> ResponseReturnValue:
    task_id = uuid4().hex
    job_dir = str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR'])
    lock = acquire_library_refresh_lock(user_id=AIRING_SYNC_LOCK_USER_ID, task_id=task_id, lock_dir=job_dir)
    if not lock.acquired:
        job = load_library_refresh_job(job_dir, lock.task_id)
        visible_job = job if job is not None and job.get('kind') == 'airing_anime_sync' else None
        return jsonify({'queued': False, 'taskId': lock.task_id, 'job': _library_refresh_job_response(visible_job)}), 202
    store_library_refresh_job(
        job_dir,
        task_id,
        {
            'jobId': task_id,
            'userId': _user.id,
            'kind': 'airing_anime_sync',
            'status': 'queued',
            'progress': _library_refresh_progress('queued', 0, 1, 'Airing anime refresh queued'),
            'summary': None,
        },
    )
    try:
        task = refresh_airing_anime.apply_async(args=(lock.lock_path, job_dir, task_id), task_id=task_id)
    except Exception:
        release_library_refresh_lock(lock.lock_path)
        raise
    return jsonify({'queued': True, 'taskId': task.id, 'job': _library_refresh_job_response(load_library_refresh_job(job_dir, task.id))}), 202


@anime_info_bp.get('/airing/sync')
@require_auth_user
def get_current_airing_anime_sync(_db: Session, user: User) -> ResponseReturnValue:
    _ = user
    job = current_job_by_kind(str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR']), kind='airing_anime_sync')
    return jsonify({'job': _library_refresh_job_response(job)})


@anime_info_bp.get('/airing/sync/<job_id>')
@require_auth_user
def get_airing_anime_sync(_db: Session, user: User, job_id: str) -> ResponseReturnValue:
    _ = user
    job = load_library_refresh_job(str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR']), job_id)
    if job is None or job.get('kind') != 'airing_anime_sync':
        return jsonify({'message': 'Airing anime refresh job not found'}), 404
    return jsonify(_library_refresh_job_response(job))


@anime_info_bp.post('/library/<int:anime_id>/discover-related-anime')
@require_auth_user
def discover_library_related_anime(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    anime = db.get(AnimeMetaInfo, anime_id)
    if anime is None:
        return jsonify({'message': 'Anime not found'}), 404
    if progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        return jsonify({'message': 'Related anime discovery is disabled while using local snapshot metadata'}), 400
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
    return _queue_library_refresh(user)


@anime_info_bp.post('/library/sync-all/failed')
@require_auth_user
def sync_failed_library_anime(_db: Session, user: User) -> ResponseReturnValue:
    job_dir = str(current_app.config['LIBRARY_REFRESH_JOB_LOCK_DIR'])
    previous_job = current_library_refresh_job(job_dir, user.id)
    anime_ids = _failed_library_refresh_anime_ids(previous_job)
    if not anime_ids:
        return jsonify({'message': 'No failed anime to retry'}), 400
    return _queue_library_refresh(user, anime_ids=anime_ids)


def _queue_library_refresh(user: User, anime_ids: list[int] | None = None) -> ResponseReturnValue:
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
        {
            'jobId': task_id,
            'userId': user.id,
            'kind': 'library_refresh',
            'status': 'queued',
            'progress': progress,
            'summary': None,
            'retryFailedOnly': anime_ids is not None,
        },
    )
    try:
        task = refresh_user_library.apply_async(args=(user.id, lock.lock_path, job_dir, task_id, anime_ids), task_id=task_id)
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
    if job is None or job.get('userId') != user.id or job.get('kind') not in {None, 'library_refresh'}:
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
        'retryFailedOnly': job.get('retryFailedOnly') is True,
    }


def _failed_library_refresh_anime_ids(job: dict[str, object] | None) -> list[int]:
    if job is None:
        return []
    summary = job.get('summary')
    if not isinstance(summary, dict):
        return []
    sync_summary = summary.get('sync')
    if not isinstance(sync_summary, dict):
        return []
    failed_anime = sync_summary.get('failedAnime')
    if not isinstance(failed_anime, list):
        return []
    anime_ids: list[int] = []
    for item in failed_anime:
        if not isinstance(item, dict):
            continue
        anime_id = item.get('animeId')
        if isinstance(anime_id, int) and anime_id not in anime_ids:
            anime_ids.append(anime_id)
    return anime_ids


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
    provider_relations = [relation for relation in anime.related_anime if relation.is_active and relation.relation_type == 'same_series_season']
    fallback_relations = [] if provider_relations else _fallback_related_relations(db, user_id=user.id, anime_id=anime.id)
    effective_relations = provider_relations or fallback_relations
    source_by_relation_id = {relation.id: 'provider' for relation in effective_relations}
    relation_ids = [relation.id for relation in effective_relations]
    related_anime_ids = [relation.related_anime_id for relation in effective_relations if relation.related_anime_id is not None]
    related_anime_overrides = {}
    related_anime_override_provider_import = {}
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
        related_anime_override_provider_import = {override.anime_relation_id: override.allow_provider_import for override in overrides}
        related_anime_ids.extend(override.related_anime_id for override in overrides)
    reverse_overrides = db.scalars(
        select(UserAnimeRelationOverride)
        .options(
            selectinload(UserAnimeRelationOverride.anime_relation).selectinload(AnimeRelation.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeRelationOverride.anime_relation).selectinload(AnimeRelation.anime).selectinload(AnimeMetaInfo.posters),
        )
        .where(
            UserAnimeRelationOverride.user_id == user.id,
            UserAnimeRelationOverride.related_anime_id == anime.id,
        ),
    ).all()
    reverse_overrides = [override for override in reverse_overrides if override.anime_relation.is_active]
    reverse_override_relation_ids = {override.anime_relation_id for override in reverse_overrides}
    related_anime_ids.extend(override.anime_relation.anime_id for override in reverse_overrides)
    related_library_anime_ids = set()
    related_anime_progresses = {}
    manual_relations = db.scalars(
        select(UserManualAnimeRelation)
        .options(
            selectinload(UserManualAnimeRelation.anime_low).selectinload(AnimeMetaInfo.names),
            selectinload(UserManualAnimeRelation.anime_high).selectinload(AnimeMetaInfo.names),
            selectinload(UserManualAnimeRelation.anime_low).selectinload(AnimeMetaInfo.posters),
            selectinload(UserManualAnimeRelation.anime_high).selectinload(AnimeMetaInfo.posters),
        )
        .where(
            UserManualAnimeRelation.user_id == user.id,
            (UserManualAnimeRelation.anime_id_low == anime.id) | (UserManualAnimeRelation.anime_id_high == anime.id),
        ),
    ).all()
    related_anime_ids.extend(
        relation.anime_id_high if relation.anime_id_low == anime.id else relation.anime_id_low
        for relation in manual_relations
    )
    pending_prompts = db.scalars(
        select(UserAnimeRelationDeletionPrompt)
        .options(
            selectinload(UserAnimeRelationDeletionPrompt.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeRelationDeletionPrompt.anime).selectinload(AnimeMetaInfo.posters),
            selectinload(UserAnimeRelationDeletionPrompt.related_anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeRelationDeletionPrompt.related_anime).selectinload(AnimeMetaInfo.posters),
        )
        .where(
            UserAnimeRelationDeletionPrompt.user_id == user.id,
            (UserAnimeRelationDeletionPrompt.anime_id == anime.id) | (UserAnimeRelationDeletionPrompt.related_anime_id == anime.id),
            UserAnimeRelationDeletionPrompt.status == 'pending',
        ),
    ).all()
    pending_prompt_relation_ids = {prompt.anime_relation_id for prompt in pending_prompts if prompt.anime_relation_id is not None}
    related_anime_ids.extend(
        prompt.related_anime_id if prompt.anime_id == anime.id else prompt.anime_id
        for prompt in pending_prompts
        if prompt.related_anime_id is not None
    )
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
    manual_target_ids = {
        relation.anime_id_high if relation.anime_id_low == anime.id else relation.anime_id_low
        for relation in manual_relations
    }
    related_anime_items = []
    for relation in sorted(effective_relations, key=lambda item: (item.season_number is None, item.season_number or 0, item.id)):
        if relation.id in reverse_override_relation_ids and relation.anime_id != anime.id:
            continue
        override_anime = related_anime_overrides.get(relation.id)
        effective_related_id = override_anime.id if override_anime is not None else relation.related_anime_id
        if effective_related_id in manual_target_ids:
            continue
        related_anime_items.append(
            serialize_related_anime(
                relation,
                user=user,
                library_anime_ids=related_library_anime_ids,
                override_anime=override_anime,
                allow_provider_import=related_anime_override_provider_import.get(relation.id),
                related_anime_progresses=related_anime_progresses,
                source=source_by_relation_id[relation.id],
                pending_upstream_deletion=relation.id in pending_prompt_relation_ids,
            ),
        )
    related_anime_items.extend(
        _serialize_manual_related_anime(relation, current_anime_id=anime.id, related_anime_progresses=related_anime_progresses, user=user)
        for relation in sorted(manual_relations, key=lambda item: item.id)
    )
    related_anime_items.extend(
        _serialize_reverse_override_related_anime(override, related_anime_progresses=related_anime_progresses, user=user)
        for override in sorted(reverse_overrides, key=lambda item: item.id)
        if override.anime_relation.anime_id not in manual_target_ids
    )
    visible_relation_ids = {item['relationId'] for item in related_anime_items if item.get('relationId') is not None}
    related_anime_items.extend(
        _serialize_deletion_prompt_related_anime(prompt, current_anime_id=anime.id, related_anime_progresses=related_anime_progresses, user=user)
        for prompt in sorted(pending_prompts, key=lambda item: item.id)
        if prompt.anime_relation_id not in visible_relation_ids and prompt.related_anime_id not in manual_target_ids
    )
    related_anime_items = _dedupe_related_anime_items(related_anime_items)
    metadata_snapshot = get_metadata_snapshot(db, user_id=user.id, anime_id=anime.id)
    episode_conflicts = [] if progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value else get_episode_conflicts(db, anime_id=anime.id, user_id=user.id)
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
                related_anime_override_provider_import=related_anime_override_provider_import,
                related_anime_progresses=related_anime_progresses,
                related_anime_items=related_anime_items,
            ),
            'progress': serialize_progress(progress, has_local_snapshot=metadata_snapshot is not None),
            'metadataSnapshot': serialize_metadata_snapshot(metadata_snapshot),
            'episodeConflicts': [serialize_episode_conflict(conflict) for conflict in episode_conflicts],
            'features': {
                'seasonDiscovery': progress.metadata_source != UserAnimeMetadataSource.LOCAL_SNAPSHOT.value and _season_discovery_enabled(anime.provider_type),
            },
        },
    )


def _dedupe_related_anime_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[tuple[object, object], tuple[int, int, dict[str, Any]]] = {}
    for index, item in enumerate(items):
        anime_id = item.get('animeId')
        identity = anime_id if anime_id is not None else (item.get('provider'), item.get('externalId'))
        key = (identity, item.get('relationType'))
        priority = _related_anime_item_priority(item)
        existing = selected.get(key)
        if existing is None or priority > existing[0]:
            selected[key] = (priority, index, item)
    return [item for _priority, _index, item in sorted(selected.values(), key=itemgetter(1))]


def _related_anime_item_priority(item: dict[str, Any]) -> int:
    if item.get('source') == 'manual':
        return 4
    if item.get('mappedByOverride') or item.get('pendingUpstreamDeletion'):
        return 3
    if item.get('source') == 'provider':
        return 2
    return 0


def _serialize_manual_related_anime(
    relation: UserManualAnimeRelation,
    *,
    current_anime_id: int,
    related_anime_progresses: dict[int, UserAnimeProgress],
    user: User,
) -> dict[str, object]:
    related_anime = relation.anime_high if relation.anime_id_low == current_anime_id else relation.anime_low
    progress = related_anime_progresses.get(related_anime.id)
    title = relation.snapshot_title or related_anime.original_name
    if progress is not None:
        selected_name = select_anime_name_for_user(sorted(related_anime.names, key=lambda item: item.id), progress, user)
        title = selected_name.name if selected_name is not None else related_anime.original_name
    poster = min(related_anime.posters, key=lambda item: (item.status != 'ready', item.id), default=None)
    poster_url = None
    if poster is not None:
        poster_url = f'/api/anime/{poster.anime_id}/assets/posters/{poster.id}?v={poster.id}-{poster.status}'
    return {
        'provider': 'manual',
        'externalId': f'manual:{relation.id}',
        'animeId': related_anime.id,
        'inLibrary': progress is not None,
        'title': title,
        'relationType': relation.relation_type,
        'seasonNumber': None,
        'airDate': relation.snapshot_air_date.isoformat() if relation.snapshot_air_date is not None else related_anime.air_date.isoformat() if related_anime.air_date is not None else None,
        'episodeCount': relation.snapshot_episode_count if relation.snapshot_episode_count is not None else related_anime.total_episodes,
        'url': related_anime.url,
        'posterUrl': poster_url,
        'source': 'manual',
        'mappedByOverride': False,
        'needsManualMapping': False,
        'pendingUpstreamDeletion': False,
        'relationId': None,
        'manualRelationId': relation.id,
    }


def _serialize_reverse_override_related_anime(
    override: UserAnimeRelationOverride,
    *,
    related_anime_progresses: dict[int, UserAnimeProgress],
    user: User,
) -> dict[str, object]:
    relation = override.anime_relation
    source_anime = relation.anime
    source_progress = related_anime_progresses.get(source_anime.id)
    title = source_anime.original_name
    if source_progress is not None:
        selected_name = select_anime_name_for_user(sorted(source_anime.names, key=lambda item: item.id), source_progress, user)
        title = selected_name.name if selected_name is not None else source_anime.original_name
    poster = min(source_anime.posters, key=lambda item: (item.status != 'ready', item.id), default=None)
    poster_url = None
    if poster is not None:
        poster_url = f'/api/anime/{poster.anime_id}/assets/posters/{poster.id}?v={poster.id}-{poster.status}'
    return {
        'provider': source_anime.provider_type,
        'externalId': source_anime.external_id,
        'animeId': source_anime.id,
        'inLibrary': source_progress is not None,
        'title': title,
        'relationType': relation.relation_type,
        'seasonNumber': relation.season_number,
        'airDate': source_anime.air_date.isoformat() if source_anime.air_date is not None else None,
        'episodeCount': source_anime.total_episodes,
        'url': source_anime.url,
        'posterUrl': poster_url,
        'source': 'provider',
        'mappedByOverride': True,
        'needsManualMapping': False,
        'pendingUpstreamDeletion': False,
        'relationId': relation.id,
        'manualRelationId': None,
        'allowProviderImport': override.allow_provider_import,
    }


def _serialize_deletion_prompt_related_anime(
    prompt: UserAnimeRelationDeletionPrompt,
    *,
    current_anime_id: int,
    related_anime_progresses: dict[int, UserAnimeProgress],
    user: User,
) -> dict[str, object]:
    target_anime = prompt.related_anime if prompt.anime_id == current_anime_id else prompt.anime
    target_anime_id = target_anime.id if target_anime is not None else prompt.related_anime_id
    related_progress = related_anime_progresses.get(target_anime_id) if target_anime_id is not None else None
    title = prompt.title
    if related_progress is not None:
        selected_name = select_anime_name_for_user(sorted(related_progress.anime.names, key=lambda item: item.id), related_progress, user)
        title = selected_name.name if selected_name is not None else related_progress.anime.original_name
    elif target_anime is not None:
        title = target_anime.original_name
    poster_url = None
    if target_anime is not None:
        poster = min(target_anime.posters, key=lambda item: (item.status != 'ready', item.id), default=None)
        if poster is not None:
            poster_url = f'/api/anime/{poster.anime_id}/assets/posters/{poster.id}?v={poster.id}-{poster.status}'
    return {
        'provider': prompt.provider,
        'externalId': prompt.external_id,
        'animeId': target_anime_id,
        'inLibrary': related_progress is not None,
        'title': title,
        'relationType': prompt.relation_type,
        'seasonNumber': prompt.season_number,
        'airDate': prompt.air_date.isoformat() if prompt.air_date is not None else None,
        'episodeCount': prompt.episode_count,
        'url': None,
        'posterUrl': poster_url,
        'source': 'provider',
        'mappedByOverride': False,
        'needsManualMapping': target_anime_id is None or related_progress is None,
        'pendingUpstreamDeletion': True,
        'relationId': prompt.anime_relation_id,
        'manualRelationId': None,
        'deletionPromptId': prompt.id,
    }


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
