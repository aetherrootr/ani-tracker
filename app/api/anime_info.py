from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.utils.auth import require_auth_user
from app.api.utils.library import (
    build_navigation_anchors,
    get_search_library_markers,
    library_search_condition,
    sort_library_progresses,
)
from app.api.utils.parsing import (
    parse_library_limit,
    parse_library_offset,
    parse_library_order,
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
    serialize_duplicate_anime_candidate,
    serialize_anime_name,
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
from app.models.progress import (
    UserAnimeProgress,
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

anime_info_bp = Blueprint("anime_info", __name__)


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
def list_import_providers(db: Session, user: User) -> ResponseReturnValue:
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
    keyword = request.args.get('q', '').strip()

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

    all_progresses = sort_library_progresses(db.scalars(stmt).all(), sort=sort, order=order, user=user)
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
            ),
            'progress': serialize_progress(progress),
        },
    )


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
