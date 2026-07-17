from __future__ import annotations

from flask import Blueprint, jsonify, request, session
from flask.typing import ResponseReturnValue
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.utils.auth import (
    hash_password,
    user_to_auth_dict,
    validate_login_payload,
    validate_register_payload,
    verify_password,
)
from app.db import get_db
from app.models.user import User

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
    if user is None or not user.password_login_enabled or not verify_password(user.password_hash, payload["password"]):
        return jsonify({"message": "Invalid username or password"}), 401

    session.clear()
    session["user_id"] = user.id
    return jsonify({"user": user_to_auth_dict(user)}), 200


@auth_bp.post("/logout")
def logout() -> ResponseReturnValue:
    session.clear()
    return jsonify({"success": True}), 200
