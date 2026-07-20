from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy.orm import Session

from app.api.utils.auth import require_auth_user
from app.api.utils.library import (
    TRACKING_LIST_RECENT_LIMIT,
    tracking_list_backlog_page,
    tracking_list_recently_watched_page,
    tracking_list_tracking_page,
)
from app.api.utils.parsing import (
    parse_library_limit,
    parse_library_offset,
)
from app.api.utils.serializers import (
    serialize_progress,
)
from app.models.anime import (
    Episode,
)
from app.models.progress import UserAnimeMetadataSource
from app.models.user import User
from app.services.anime_library import (
    get_user_progress,
    set_episode_watch_state,
    set_episode_watch_state_bulk,
    set_episode_watch_times_to_air_times,
    set_snapshot_episode_watch_state,
)
from app.services.anime_statistics import get_watch_timeline

watch_state_bp = Blueprint("watch_state", __name__)


@watch_state_bp.get('/tracking-list/tracking')
@require_auth_user
def get_tracking_list_tracking(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), default=20, maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    return jsonify(tracking_list_tracking_page(db, user, limit=limit, offset=offset))


@watch_state_bp.get('/tracking-list/backlog')
@require_auth_user
def get_tracking_list_backlog(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), default=20, maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    return jsonify(tracking_list_backlog_page(db, user, limit=limit, offset=offset))


@watch_state_bp.get('/tracking-list/recently-watched')
@require_auth_user
def get_tracking_list_recently_watched(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), default=TRACKING_LIST_RECENT_LIMIT, maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    return jsonify(tracking_list_recently_watched_page(db, user, limit=limit, offset=offset))


@watch_state_bp.get('/watch-timeline')
@require_auth_user
def get_statistics_watch_timeline(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), default=30, maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    return jsonify(get_watch_timeline(db, user, limit=limit, offset=offset))


@watch_state_bp.patch('/anime/<int:anime_id>/episodes/<int:episode_id>')
@require_auth_user
def update_episode_watch_state(db: Session, user: User, anime_id: int, episode_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get('watched'), bool):
        return jsonify({'message': 'Episode watched state is required'}), 400
    watched_at = None
    if 'watchedAt' in payload:
        if not payload['watched'] or not isinstance(payload['watchedAt'], str):
            return (
                jsonify({'message': 'watchedAt requires a watched episode and an ISO 8601 timestamp'}),
                400,
            )
        try:
            watched_at = datetime.fromisoformat(payload['watchedAt'])
        except ValueError:
            return jsonify({'message': 'watchedAt must be a valid ISO 8601 timestamp'}), 400
        if watched_at.tzinfo is None or watched_at.utcoffset() is None:
            return jsonify({'message': 'watchedAt must include a timezone'}), 400
        watched_at = watched_at.astimezone(UTC)
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is not None and progress.metadata_source == UserAnimeMetadataSource.LOCAL_SNAPSHOT.value:
        snapshot_episode = set_snapshot_episode_watch_state(
            db,
            progress=progress,
            episode_id=episode_id,
            watched=payload['watched'],
            watched_at=watched_at,
        )
        if snapshot_episode is None:
            return jsonify({'message': 'Episode not found'}), 404
        return jsonify(
            {
                'episode': {
                    'id': snapshot_episode.id,
                    'episodeNumber': snapshot_episode.episode_number,
                    'watched': snapshot_episode.watched,
                    'watchedAt': snapshot_episode.watched_at.isoformat() if snapshot_episode.watched_at else None,
                },
                'progress': serialize_progress(progress),
            },
        )
    episode = db.get(Episode, episode_id)
    if progress is None or episode is None or episode.anime_id != anime_id:
        return jsonify({'message': 'Episode not found'}), 404
    watch_progress = set_episode_watch_state(
        db,
        progress=progress,
        episode=episode,
        watched=payload['watched'],
        watched_at=watched_at,
    )
    return jsonify(
        {
            'episode': {
                'id': episode.id,
                'episodeNumber': episode.episode_number,
                'watched': bool(watch_progress.watched) if watch_progress is not None else False,
                'watchedAt': watch_progress.watched_at.isoformat() if watch_progress is not None and watch_progress.watched_at else None,
            },
            'progress': serialize_progress(progress),
        },
    )


@watch_state_bp.patch('/anime/<int:anime_id>/episodes')
@require_auth_user
def update_episode_watch_state_bulk(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get('watched'), bool):
        return jsonify({'message': 'Episode watched state is required'}), 400
    scope = payload.get('scope')
    if scope not in {'all', 'aired', 'through'}:
        return jsonify({'message': 'Episode scope is invalid'}), 400
    through_episode_number = payload.get('throughEpisodeNumber')
    if scope == 'through' and (not isinstance(through_episode_number, int) or through_episode_number < 1):
        return jsonify({'message': 'throughEpisodeNumber must be a positive integer'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    matched_count, changed_count = set_episode_watch_state_bulk(
        db,
        progress=progress,
        watched=payload['watched'],
        scope=scope,
        through_episode_number=through_episode_number,
    )
    return jsonify({
        'matchedCount': matched_count,
        'changedCount': changed_count,
        'progress': serialize_progress(progress),
    })


@watch_state_bp.patch('/anime/<int:anime_id>/episodes/watched-at')
@require_auth_user
def update_episode_watch_times_to_air_times(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    matched_count, changed_count = set_episode_watch_times_to_air_times(db, progress=progress)
    return jsonify({
        'matchedCount': matched_count,
        'changedCount': changed_count,
        'progress': serialize_progress(progress),
    })
