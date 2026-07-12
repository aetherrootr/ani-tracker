from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.utils.auth import require_auth_user
from app.api.utils.parsing import (
    parse_library_limit,
    parse_library_offset,
    total_pages,
)
from app.api.utils.serializers import (
    select_episode_name_for_user,
    serialize_anime,
    serialize_episode_name,
    serialize_episode_with_watch_state,
    serialize_progress,
)
from app.models.anime import (
    AnimeMetaInfo,
    Episode,
    EpisodeName,
)
from app.models.progress import (
    get_anime_episodes_with_watch_state,
)
from app.models.user import User
from app.services.anime_library import (
    get_user_progress,
    set_episode_name_preference,
)
from app.services.anime_sync import (
    resolve_episode_conflicts,
)

anime_episodes_bp = Blueprint("anime_episodes", __name__)


@anime_episodes_bp.post('/library/<int:anime_id>/sync/episode-conflicts/resolve')
@require_auth_user
def resolve_library_anime_sync_episode_conflicts(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get('deleteEpisodeIds'), list):
        return jsonify({'message': 'deleteEpisodeIds is required'}), 400
    delete_episode_ids = payload['deleteEpisodeIds']
    if not all(isinstance(episode_id, int) for episode_id in delete_episode_ids):
        return jsonify({'message': 'deleteEpisodeIds is invalid'}), 400

    try:
        summary = resolve_episode_conflicts(
            db,
            anime_id=anime_id,
            user_id=user.id,
            delete_episode_ids=delete_episode_ids,
        )
        if summary is None:
            db.rollback()
            return jsonify({'message': 'Anime not found'}), 404
        db.commit()
    except Exception:
        db.rollback()
        raise

    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    anime = db.get(AnimeMetaInfo, anime_id)
    if progress is None or anime is None:
        return jsonify({'message': 'Anime not found'}), 404
    return jsonify(
        {
            'anime': serialize_anime(anime, progress, user),
            'progress': serialize_progress(progress),
            'resolution': summary,
        },
    )


@anime_episodes_bp.get('/library/<int:anime_id>/episodes')
@require_auth_user
def list_episodes(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    if get_user_progress(db, user_id=user.id, anime_id=anime_id) is None:
        return jsonify({'message': 'Anime not found'}), 404
    limit, error = parse_library_limit(request.args.get('limit'), default=200, maximum=500)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    rows = get_anime_episodes_with_watch_state(db, anime_id=anime_id, user_id=user.id, limit=limit, offset=offset)
    total = db.scalar(select(func.count(Episode.id)).where(Episode.anime_id == anime_id)) or 0
    episode_ids = [row['episode_id'] for row in rows]
    names_by_episode: dict[int, list[EpisodeName]] = {episode_id: [] for episode_id in episode_ids}
    if episode_ids:
        episode_names = db.scalars(
            select(EpisodeName)
            .where(EpisodeName.episode_id.in_(episode_ids))
            .order_by(EpisodeName.id),
        ).all()
        for name in episode_names:
            names_by_episode.setdefault(name.episode_id, []).append(name)
    return jsonify(
        {
            'animeId': anime_id,
            'total': total,
            'limit': limit,
            'offset': offset,
            'page': offset // limit + 1,
            'totalPages': total_pages(total, limit),
            'episodes': [
                {
                    **serialize_episode_with_watch_state(
                        row,
                        selected_name=select_episode_name_for_user(
                            names_by_episode.get(row['episode_id'], []),
                            user,
                            preferred_name_id=row['preferred_name_id'],
                        ),
                    ),
                    'availableNames': [
                        serialize_episode_name(name)
                        for name in names_by_episode.get(row['episode_id'], [])
                    ],
                    'preferredNameId': row['preferred_name_id'],
                }
                for row in rows
            ],
        },
    )


@anime_episodes_bp.patch('/library/<int:anime_id>/episodes/<int:episode_id>/name-preference')
@require_auth_user
def update_episode_name_preference(db: Session, user: User, anime_id: int, episode_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('nameId' not in payload):
        return jsonify({'message': 'nameId is required'}), 400
    name_id = payload['nameId']
    if name_id is not None and not isinstance(name_id, int):
        return jsonify({'message': 'nameId is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    episode = db.get(Episode, episode_id)
    if progress is None or episode is None or episode.anime_id != anime_id:
        return jsonify({'message': 'Episode not found'}), 404
    episode_progress = set_episode_name_preference(db, progress=progress, episode=episode, name_id=name_id)
    if episode_progress is None:
        return jsonify({'message': 'nameId is invalid'}), 400
    names = db.scalars(select(EpisodeName).where(EpisodeName.episode_id == episode_id).order_by(EpisodeName.id)).all()
    selected = next((name for name in names if name.id == episode_progress.preferred_name_id), None)
    if selected is None:
        selected = select_episode_name_for_user(names, user, preferred_name_id=episode_progress.preferred_name_id)
    return jsonify(
        {
            'name': serialize_episode_name(selected),
            'episode': {'id': episode.id, 'animeId': anime_id, 'preferredNameId': episode_progress.preferred_name_id},
        },
    )
