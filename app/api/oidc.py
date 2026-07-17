from __future__ import annotations

import time

from flask import Blueprint, current_app, jsonify, redirect, request, session
from flask.typing import ResponseReturnValue
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.utils.auth import user_to_auth_dict, verify_password
from app.api.utils.oidc import (
    OIDC_AUTH_FAILED,
    create_oidc_identity,
    create_oidc_user,
    fetch_oidc_claims,
    get_oidc_client,
    get_oidc_issuer,
    get_oidc_redirect_uri,
    oidc_not_configured,
)
from app.db import get_db
from app.models.user import User, UserOidcIdentity

oidc_bp = Blueprint("oidc", __name__)
PASSWORD_SETUP_MAX_AGE_SECONDS = 600


@oidc_bp.get("/config")
def oidc_config() -> ResponseReturnValue:
    return jsonify({"enabled": bool(current_app.config.get("OIDC_ENABLED"))}), 200


@oidc_bp.get("/login")
def oidc_login() -> ResponseReturnValue:
    client = get_oidc_client()
    if client is None:
        return oidc_not_configured()

    return client.authorize_redirect(redirect_uri=get_oidc_redirect_uri("oidc.oidc_callback"))


@oidc_bp.get("/callback")
def oidc_callback() -> ResponseReturnValue:
    client = get_oidc_client()
    if client is None:
        return oidc_not_configured()

    claims, error = fetch_oidc_claims(client)
    if error is not None or claims is None:
        return jsonify({"message": error}), 400

    db = get_db()
    issuer = get_oidc_issuer()
    subject = str(claims["sub"])
    identity = db.scalar(
        select(UserOidcIdentity).where(
            UserOidcIdentity.issuer == issuer,
            UserOidcIdentity.subject == subject,
        ),
    )

    if identity is None:
        user = create_oidc_user(db, issuer=issuer, subject=subject, claims=claims)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return jsonify({"message": OIDC_AUTH_FAILED}), 409
    else:
        existing_user = db.get(User, identity.user_id)
        if existing_user is None:
            return jsonify({"message": OIDC_AUTH_FAILED}), 400
        user = existing_user

    session.clear()
    session["user_id"] = user.id
    return redirect(str(current_app.config["OIDC_POST_LOGIN_REDIRECT"]))


@oidc_bp.get("/link")
def oidc_link() -> ResponseReturnValue:
    client = get_oidc_client()
    if client is None:
        return oidc_not_configured()

    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401

    if get_db().get(User, user_id) is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401

    session["oidc_link_user_id"] = user_id
    return client.authorize_redirect(redirect_uri=get_oidc_redirect_uri("oidc.oidc_link_callback"))


@oidc_bp.get("/password-setup")
def oidc_password_setup() -> ResponseReturnValue:
    client = get_oidc_client()
    if client is None:
        return oidc_not_configured()

    user_id = session.get("user_id")
    if not isinstance(user_id, int) or get_db().get(User, user_id) is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401

    session["oidc_password_setup_user_id"] = user_id
    return client.authorize_redirect(redirect_uri=get_oidc_redirect_uri("oidc.oidc_password_setup_callback"))


@oidc_bp.get("/password-setup/callback")
def oidc_password_setup_callback() -> ResponseReturnValue:
    client = get_oidc_client()
    if client is None:
        return oidc_not_configured()

    user_id = session.get("user_id")
    setup_user_id = session.get("oidc_password_setup_user_id")
    if not isinstance(user_id, int) or user_id != setup_user_id:
        return jsonify({"message": "Authentication required"}), 401

    claims, error = fetch_oidc_claims(client)
    if error is not None or claims is None:
        return jsonify({"message": error}), 400

    identity = get_db().scalar(
        select(UserOidcIdentity).where(
            UserOidcIdentity.user_id == user_id,
            UserOidcIdentity.issuer == get_oidc_issuer(),
            UserOidcIdentity.subject == str(claims["sub"]),
        ),
    )
    if identity is None:
        return jsonify({"message": "OIDC authentication failed"}), 403

    session.pop("oidc_password_setup_user_id", None)
    session["oidc_password_setup_authorized_user_id"] = user_id
    session["oidc_password_setup_authorized_at"] = time.time()
    return redirect(str(current_app.config["OIDC_POST_PASSWORD_SETUP_REDIRECT"]))


@oidc_bp.get("/password-setup/status")
def oidc_password_setup_status() -> ResponseReturnValue:
    user_id = session.get("user_id")
    authorized_user_id = session.get("oidc_password_setup_authorized_user_id")
    authorized_at = session.get("oidc_password_setup_authorized_at")
    authorized = (
        isinstance(user_id, int)
        and authorized_user_id == user_id
        and isinstance(authorized_at, (int, float))
        and time.time() - authorized_at <= PASSWORD_SETUP_MAX_AGE_SECONDS
    )
    return jsonify({"authorized": authorized}), 200


@oidc_bp.get("/link/callback")
def oidc_link_callback() -> ResponseReturnValue:
    client = get_oidc_client()
    if client is None:
        return oidc_not_configured()

    user_id = session.get("user_id")
    link_user_id = session.get("oidc_link_user_id")
    if not isinstance(user_id, int) or user_id != link_user_id:
        return jsonify({"message": "Authentication required"}), 401

    claims, error = fetch_oidc_claims(client)
    if error is not None or claims is None:
        return jsonify({"message": error}), 400

    db = get_db()
    user = db.get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401

    issuer = get_oidc_issuer()
    subject = str(claims["sub"])
    identity = db.scalar(
        select(UserOidcIdentity).where(
            UserOidcIdentity.issuer == issuer,
            UserOidcIdentity.subject == subject,
        ),
    )
    if identity is not None:
        if identity.user_id == user.id:
            session.pop("oidc_link_user_id", None)
            return redirect(str(current_app.config["OIDC_POST_LINK_REDIRECT"]))
        return jsonify({"message": "OIDC identity is already linked to another user"}), 409

    existing_user_identity = db.scalar(
        select(UserOidcIdentity).where(
            UserOidcIdentity.user_id == user.id,
            UserOidcIdentity.issuer == issuer,
        ),
    )
    if existing_user_identity is not None:
        return jsonify({"message": "User already has an OIDC identity for this issuer"}), 409

    db.add(create_oidc_identity(user_id=user.id, issuer=issuer, subject=subject, claims=claims))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return jsonify({"message": "OIDC identity could not be linked"}), 409

    session.pop("oidc_link_user_id", None)
    return redirect(str(current_app.config["OIDC_POST_LINK_REDIRECT"]))


@oidc_bp.delete("/link")
def oidc_unlink() -> ResponseReturnValue:
    if not current_app.config.get("OIDC_ENABLED"):
        return oidc_not_configured()

    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401

    db = get_db()
    user = db.get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401

    if not user.password_login_enabled:
        return jsonify({"message": "Set a password before unlinking the only available login method"}), 409

    payload = request.get_json(silent=True)
    current_password = payload.get("currentPassword") if isinstance(payload, dict) else None
    if not isinstance(current_password, str) or not current_password or not verify_password(user.password_hash, current_password):
        return jsonify({"message": "Current password could not be verified"}), 403

    identity = db.scalar(
        select(UserOidcIdentity).where(
            UserOidcIdentity.user_id == user.id,
            UserOidcIdentity.issuer == get_oidc_issuer(),
        ),
    )
    if identity is not None:
        db.delete(identity)
        db.commit()
        db.expire(user, ["oidc_identities"])

    return jsonify({"user": user_to_auth_dict(user)}), 200
