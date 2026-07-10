from __future__ import annotations

from flask import Blueprint, current_app, jsonify, redirect, request, session
from flask.typing import ResponseReturnValue
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.utils.auth import (
    hash_password,
    user_to_auth_dict,
    validate_language_preference_payload,
    validate_login_payload,
    validate_register_payload,
    verify_password,
)
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

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/register")
def register() -> ResponseReturnValue:
    payload, error = validate_register_payload(request.get_json(silent=True))
    if error is not None or payload is None:
        return jsonify({"message": error}), 400

    db = get_db()
    existing_user = db.scalar(select(User).where(User.username == payload["username"]))
    if existing_user is not None:
        return jsonify({"message": "Username already exists"}), 409

    user = User(
        username=payload["username"],
        email=payload["email"],
        display_name=payload["display_name"],
        language_preference=payload["language_preference"],
        password_hash=hash_password(payload["password"] or ""),
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return jsonify({"message": "Username already exists"}), 409

    session.clear()
    session["user_id"] = user.id
    return jsonify({"user": user_to_auth_dict(user)}), 201


@auth_bp.post("/login")
def login() -> ResponseReturnValue:
    payload, error = validate_login_payload(request.get_json(silent=True))
    if error is not None or payload is None:
        return jsonify({"message": error}), 400

    db = get_db()
    user = db.scalar(select(User).where(User.username == payload["username"]))
    if user is None or not verify_password(user.password_hash, payload["password"]):
        return jsonify({"message": "Invalid username or password"}), 401

    session.clear()
    session["user_id"] = user.id
    return jsonify({"user": user_to_auth_dict(user)}), 200


@auth_bp.post("/logout")
def logout() -> ResponseReturnValue:
    session.clear()
    return jsonify({"success": True}), 200


@auth_bp.get("/me")
def me() -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"user": None}), 200

    user = get_db().get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"user": None}), 200

    return jsonify({"user": user_to_auth_dict(user)}), 200


@auth_bp.patch("/me/language-preference")
def update_language_preference() -> ResponseReturnValue:
    user_id = session.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"message": "Authentication required"}), 401

    language_preference, error = validate_language_preference_payload(request.get_json(silent=True))
    if error is not None or language_preference is None:
        return jsonify({"message": error}), 400

    db = get_db()
    user = db.get(User, user_id)
    if user is None:
        session.clear()
        return jsonify({"message": "Authentication required"}), 401

    user.language_preference = language_preference
    db.commit()

    return jsonify({"user": user_to_auth_dict(user)}), 200


@auth_bp.get("/oidc/config")
def oidc_config() -> ResponseReturnValue:
    return jsonify({"enabled": bool(current_app.config.get("OIDC_ENABLED"))}), 200


@auth_bp.get("/oidc/login")
def oidc_login() -> ResponseReturnValue:
    client = get_oidc_client()
    if client is None:
        return oidc_not_configured()

    return client.authorize_redirect(redirect_uri=get_oidc_redirect_uri("auth.oidc_callback"))


@auth_bp.get("/oidc/callback")
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


@auth_bp.get("/oidc/link")
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
    return client.authorize_redirect(redirect_uri=get_oidc_redirect_uri("auth.oidc_link_callback"))


@auth_bp.get("/oidc/link/callback")
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


@auth_bp.delete("/oidc/link")
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
