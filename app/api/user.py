from __future__ import annotations

import time

from flask import Blueprint, jsonify, request, session
from flask.typing import ResponseReturnValue

from app.api.utils.auth import (
    hash_password,
    user_to_auth_dict,
    validate_boolean_preference_payload,
    validate_import_provider_preference_payload,
    validate_language_preference_payload,
    validate_password_update_payload,
    validate_week_start_day_payload,
    verify_password,
)
from app.api.utils.providers import get_import_provider_factory
from app.db import get_db
from app.models.user import User
from app.utils import local_timezone

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
    if (
        "languagePreference" not in payload
        and "weekStartDay" not in payload
        and "timeZone" not in payload
        and "timeZoneMode" not in payload
        and "importProviderPreference" not in payload
        and "includeUnwatchedSeasonZeroInTracking" not in payload
        and "includeUnwatchedSeasonZeroInStatistics" not in payload
    ):
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

    time_zone = None
    if "timeZone" in payload:
        value = payload.get("timeZone")
        if not isinstance(value, str) or local_timezone(value) != value.strip():
            return jsonify({"message": "Time zone must be a valid IANA identifier"}), 400
        time_zone = value.strip()

    time_zone_mode = None
    if "timeZoneMode" in payload:
        value = payload.get("timeZoneMode")
        if value not in {"auto", "manual"}:
            return jsonify({"message": "Time zone mode must be auto or manual"}), 400
        time_zone_mode = value

    import_provider_preference = None
    if "importProviderPreference" in payload:
        available_providers = {provider.name for provider in get_import_provider_factory().list_providers()}
        import_provider_preference, error = validate_import_provider_preference_payload(payload, available_providers)
        if error is not None or import_provider_preference is None:
            return jsonify({"message": error}), 400

    include_unwatched_season_zero_in_tracking = None
    if "includeUnwatchedSeasonZeroInTracking" in payload:
        include_unwatched_season_zero_in_tracking, error = validate_boolean_preference_payload(payload, "includeUnwatchedSeasonZeroInTracking", "Tracking season zero preference")
        if error is not None or include_unwatched_season_zero_in_tracking is None:
            return jsonify({"message": error}), 400

    include_unwatched_season_zero_in_statistics = None
    if "includeUnwatchedSeasonZeroInStatistics" in payload:
        include_unwatched_season_zero_in_statistics, error = validate_boolean_preference_payload(payload, "includeUnwatchedSeasonZeroInStatistics", "Statistics season zero preference")
        if error is not None or include_unwatched_season_zero_in_statistics is None:
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
    if time_zone is not None:
        user.time_zone = time_zone
    if time_zone_mode is not None:
        user.time_zone_mode = time_zone_mode
    if import_provider_preference is not None:
        user.import_provider_preference = import_provider_preference
    if include_unwatched_season_zero_in_tracking is not None:
        user.include_unwatched_season_zero_in_tracking = include_unwatched_season_zero_in_tracking
    if include_unwatched_season_zero_in_statistics is not None:
        user.include_unwatched_season_zero_in_statistics = include_unwatched_season_zero_in_statistics
    db.commit()

    return jsonify({"user": user_to_auth_dict(user)}), 200


@user_bp.patch("/me/password")
def update_password() -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401

    password_update, error = validate_password_update_payload(request.get_json(silent=True))
    if error is not None or password_update is None:
        return jsonify({"message": error}), 400

    db = get_db()
    user = db.get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401

    current_password = password_update['current_password']
    oidc_authorized_at = session.get("oidc_password_setup_authorized_at")
    oidc_authorized_user_id = session.get("oidc_password_setup_authorized_user_id")
    oidc_authorized = (
        isinstance(oidc_authorized_at, (int, float))
        and oidc_authorized_user_id == user.id
        and time.time() - oidc_authorized_at <= 600
    )
    password_verified = isinstance(current_password, str) and verify_password(user.password_hash, current_password)
    if not password_verified and not oidc_authorized:
        return jsonify({"message": "Current password could not be verified"}), 403

    new_password = password_update['new_password']
    if not isinstance(new_password, str):
        return jsonify({"message": "New password is required"}), 400
    user.password_hash = hash_password(new_password)
    user.password_login_enabled = True
    db.commit()

    session.clear()
    session["user_id"] = user.id

    return jsonify({"success": True}), 200
