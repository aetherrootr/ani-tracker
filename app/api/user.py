from __future__ import annotations

from flask import Blueprint, jsonify, request, session
from flask.typing import ResponseReturnValue

from app.api.utils.auth import (
    user_to_auth_dict,
    validate_language_preference_payload,
    validate_week_start_day_payload,
)
from app.db import get_db
from app.models.user import User

user_bp = Blueprint("user", __name__)


@user_bp.get("/me")
def me() -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"user": None}), 200

    user = get_db().get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"user": None}), 200

    return jsonify({"user": user_to_auth_dict(user)}), 200


@user_bp.patch("/me/preferences")
def update_preferences() -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"message": "Request body must be a JSON object"}), 400
    if "languagePreference" not in payload and "weekStartDay" not in payload:
        return jsonify({"message": "User preference is required"}), 400

    language_preference = None
    if "languagePreference" in payload:
        language_preference, error = validate_language_preference_payload(payload)
        if error is not None or language_preference is None:
            return jsonify({"message": error}), 400

    week_start_day = None
    if "weekStartDay" in payload:
        week_start_day, error = validate_week_start_day_payload(payload)
        if error is not None or week_start_day is None:
            return jsonify({"message": error}), 400

    db = get_db()
    user = db.get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401

    if language_preference is not None:
        user.language_preference = language_preference
    if week_start_day is not None:
        user.week_start_day = week_start_day
    db.commit()

    return jsonify({"user": user_to_auth_dict(user)}), 200
