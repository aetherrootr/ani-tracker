from __future__ import annotations

from flask import Blueprint, jsonify
from flask.typing import ResponseReturnValue
from sqlalchemy.orm import Session

from app.api.utils.auth import require_auth_user
from app.models.user import User
from app.services.anime_statistics import get_statistics_summary

statistics_bp = Blueprint("statistics", __name__)


@statistics_bp.get('/summary')
@require_auth_user
def get_statistics_summary_api(db: Session, user: User) -> ResponseReturnValue:
    return jsonify(get_statistics_summary(db, user))


@statistics_bp.post('/recalculate')
@require_auth_user
def recalculate_statistics(db: Session, user: User) -> ResponseReturnValue:
    return jsonify(get_statistics_summary(db, user))
