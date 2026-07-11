from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.utils.auth import require_auth_user
from app.api.utils.posters import send_poster_file
from app.api.utils.serializers import (
    select_poster_for_user,
    serialize_poster,
)
from app.models.anime import (
    AnimePoster,
)
from app.models.user import User
from app.services.anime_library import (
    get_user_progress,
    set_poster_preference,
)

anime_assets_bp = Blueprint("anime_assets", __name__)


@anime_assets_bp.patch('/library/<int:anime_id>/poster-preference')
@require_auth_user
def update_poster_preference(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('posterId' not in payload):
        return jsonify({'message': 'posterId is required'}), 400
    poster_id = payload['posterId']
    if poster_id is not None and not isinstance(poster_id, int):
        return jsonify({'message': 'posterId is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    if set_poster_preference(db, progress=progress, poster_id=poster_id) is None:
        return jsonify({'message': 'posterId is invalid'}), 400
    poster = db.scalar(select(AnimePoster).where(AnimePoster.id == poster_id)) if poster_id is not None else None
    return jsonify(
        {
            'poster': serialize_poster(poster, progress) if poster is not None else None,
            'progress': {'id': progress.id, 'animeId': anime_id, 'preferredPosterId': progress.preferred_poster_id},
        },
    )


@anime_assets_bp.get('/<int:anime_id>/assets/poster')
@require_auth_user
def get_poster(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Poster not found'}), 404
    posters = db.scalars(select(AnimePoster).where(AnimePoster.anime_id == anime_id).order_by(AnimePoster.id)).all()
    poster = select_poster_for_user(posters, progress)
    return send_poster_file(poster)


@anime_assets_bp.get('/<int:anime_id>/assets/posters/<int:poster_id>')
@require_auth_user
def get_poster_by_id(db: Session, user: User, anime_id: int, poster_id: int) -> ResponseReturnValue:
    if get_user_progress(db, user_id=user.id, anime_id=anime_id) is None:
        return jsonify({'message': 'Poster not found'}), 404
    poster = db.get(AnimePoster, poster_id)
    if poster is None or poster.anime_id != anime_id:
        return jsonify({'message': 'Poster not found'}), 404
    return send_poster_file(poster)
