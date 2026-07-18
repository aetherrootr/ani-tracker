from __future__ import annotations

import time

from flask import Blueprint, current_app, jsonify, request, send_file, session
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
from app.models.user import User, UserWallpaper
from app.services.user_wallpaper import (
    ALLOWED_VARIANTS,
    delete_wallpaper_file,
    read_wallpaper_upload,
    resolve_wallpaper_path,
    wallpaper_content_hash,
    write_wallpaper,
)
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
        and "wallpaperGlassStyle" not in payload
        and "wallpaperGlassIntensity" not in payload
        and "shareWallpapersOnLogin" not in payload
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

    share_wallpapers_on_login = None
    if "shareWallpapersOnLogin" in payload:
        share_wallpapers_on_login, error = validate_boolean_preference_payload(
            payload,
            "shareWallpapersOnLogin",
            "Login wallpaper sharing preference",
        )
        if error is not None or share_wallpapers_on_login is None:
            return jsonify({"message": error}), 400

    wallpaper_glass_style = None
    if "wallpaperGlassStyle" in payload:
        value = payload.get("wallpaperGlassStyle")
        if value not in {"clear", "regular", "frosted"}:
            return jsonify({"message": "Wallpaper glass style is invalid"}), 400
        wallpaper_glass_style = value

    wallpaper_glass_intensity = None
    if "wallpaperGlassIntensity" in payload:
        value = payload.get("wallpaperGlassIntensity")
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
            return jsonify({"message": "Wallpaper glass intensity is invalid"}), 400
        wallpaper_glass_intensity = value

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
    if share_wallpapers_on_login is not None:
        user.share_wallpapers_on_login = share_wallpapers_on_login
    if wallpaper_glass_style is not None:
        user.wallpaper_glass_style = wallpaper_glass_style
    if wallpaper_glass_intensity is not None:
        user.wallpaper_glass_intensity = wallpaper_glass_intensity
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


@user_bp.get("/me/wallpapers/<variant>/<int:wallpaper_id>")
def get_wallpaper(variant: str, wallpaper_id: int) -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401
    if variant not in ALLOWED_VARIANTS:
        return jsonify({"message": "Wallpaper variant is invalid"}), 404

    db = get_db()
    wallpaper = db.query(UserWallpaper).filter_by(id=wallpaper_id, user_id=user_id, variant=variant).one_or_none()
    if wallpaper is None:
        return jsonify({"message": "Wallpaper not found"}), 404
    path = resolve_wallpaper_path(str(current_app.config["USER_WALLPAPER_STORAGE_DIR"]), wallpaper.storage_path)
    if path is None or not path.is_file():
        return jsonify({"message": "Wallpaper not found"}), 404
    response = send_file(path, mimetype=wallpaper.mime_type)
    response.headers["Cache-Control"] = "private, max-age=86400"
    return response


@user_bp.post("/me/wallpapers/<variant>")
def create_wallpaper(variant: str) -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401
    if variant not in ALLOWED_VARIANTS:
        return jsonify({"message": "Wallpaper variant is invalid"}), 404

    upload = read_wallpaper_upload(request.files.get("file"), int(current_app.config["USER_WALLPAPER_MAX_BYTES"]))
    if isinstance(upload, str):
        return jsonify({"message": upload}), 400
    content, mime_type, suffix = upload

    db = get_db()
    user = db.get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401
    upload_limit = int(current_app.config["USER_WALLPAPER_MAX_IMAGES_PER_USER"])
    if db.query(UserWallpaper).filter_by(user_id=user_id).count() >= upload_limit:
        return jsonify({"message": "Wallpaper upload limit reached"}), 409
    content_hash = wallpaper_content_hash(content)
    if db.query(UserWallpaper).filter_by(user_id=user_id, variant=variant, content_hash=content_hash).first() is not None:
        return jsonify({"message": "Wallpaper has already been uploaded"}), 409

    has_variant_wallpaper = db.query(UserWallpaper).filter_by(user_id=user_id, variant=variant).first() is not None
    storage_dir = str(current_app.config["USER_WALLPAPER_STORAGE_DIR"])
    storage_path, _ = write_wallpaper(storage_dir, user_id, variant, content, suffix)
    wallpaper = UserWallpaper(
        user_id=user_id,
        variant=variant,
        storage_path=storage_path,
        mime_type=mime_type,
        size_bytes=len(content),
        content_hash=content_hash,
        selected=not has_variant_wallpaper,
    )
    db.add(wallpaper)
    db.commit()
    return jsonify({"user": user_to_auth_dict(user)}), 200


@user_bp.patch("/me/wallpapers/<variant>/preferences")
def update_wallpaper_preferences(variant: str) -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401
    if variant not in ALLOWED_VARIANTS:
        return jsonify({"message": "Wallpaper variant is invalid"}), 404
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or payload.get("mode") not in {"default", "fixed", "random"}:
        return jsonify({"message": "Wallpaper mode is invalid"}), 400

    db = get_db()
    user = db.get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401
    selected_id = payload.get("selectedWallpaperId")
    selected_wallpaper = None
    if selected_id is not None:
        if not isinstance(selected_id, int):
            return jsonify({"message": "Selected wallpaper is invalid"}), 400
        selected_wallpaper = db.query(UserWallpaper).filter_by(id=selected_id, user_id=user_id, variant=variant).one_or_none()
        if selected_wallpaper is None:
            return jsonify({"message": "Selected wallpaper is invalid"}), 400
    if selected_wallpaper is not None:
        for wallpaper in db.query(UserWallpaper).filter_by(user_id=user_id, variant=variant):
            wallpaper.selected = wallpaper.id == selected_wallpaper.id
    setattr(user, f"{variant}_wallpaper_mode", payload["mode"])
    db.commit()
    return jsonify({"user": user_to_auth_dict(user)}), 200


@user_bp.delete("/me/wallpapers/<variant>/<int:wallpaper_id>")
def delete_wallpaper(variant: str, wallpaper_id: int) -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401
    if variant not in ALLOWED_VARIANTS:
        return jsonify({"message": "Wallpaper variant is invalid"}), 404

    db = get_db()
    user = db.get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401
    wallpaper = db.query(UserWallpaper).filter_by(id=wallpaper_id, user_id=user_id, variant=variant).one_or_none()
    if wallpaper is not None:
        storage_path = wallpaper.storage_path
        was_selected = wallpaper.selected
        db.delete(wallpaper)
        db.flush()
        if was_selected:
            replacement = db.query(UserWallpaper).filter_by(user_id=user_id, variant=variant).order_by(UserWallpaper.id).first()
            if replacement is not None:
                replacement.selected = True
        db.commit()
        delete_wallpaper_file(str(current_app.config["USER_WALLPAPER_STORAGE_DIR"]), storage_path)
    return jsonify({"user": user_to_auth_dict(user)}), 200
