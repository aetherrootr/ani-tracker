from __future__ import annotations

import re

from werkzeug.security import check_password_hash, generate_password_hash

from app.models.user import User

USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    return check_password_hash(password_hash, password)


def user_to_auth_dict(user: User) -> dict[str, object]:
    return {
        "id": user.id,
        "username": user.username,
        "displayName": user.display_name,
        "email": user.email,
    }


def validate_register_payload(data: object) -> tuple[dict[str, str | None] | None, str | None]:
    if not isinstance(data, dict):
        return None, "Request body must be a JSON object"

    username = data.get("username")
    email = data.get("email")
    password = data.get("password")
    display_name = data.get("displayName")

    if not isinstance(username, str) or not username.strip():
        return None, "Username is required"
    username = username.strip()
    if len(username) < 3 or len(username) > 50:
        return None, "Username must be between 3 and 50 characters"
    if USERNAME_RE.fullmatch(username) is None:
        return None, "Username may only contain letters, numbers, underscores, and hyphens"

    if not isinstance(email, str) or not email.strip():
        return None, "Email is required"
    email = email.strip()
    if EMAIL_RE.fullmatch(email) is None:
        return None, "Email is invalid"

    if not isinstance(password, str) or not password:
        return None, "Password is required"
    if len(password) < 8:
        return None, "Password must be at least 8 characters"

    if display_name is not None:
        if not isinstance(display_name, str):
            return None, "Display name is invalid"
        display_name = display_name.strip() or None
        if display_name is not None and len(display_name) > 100:
            return None, "Display name must be at most 100 characters"

    return {
        "username": username,
        "email": email,
        "password": password,
        "display_name": display_name,
    }, None


def validate_login_payload(data: object) -> tuple[dict[str, str] | None, str | None]:
    if not isinstance(data, dict):
        return None, "Request body must be a JSON object"

    username = data.get("username")
    password = data.get("password")

    if not isinstance(username, str) or not username.strip():
        return None, "Username is required"
    if not isinstance(password, str) or not password:
        return None, "Password is required"

    return {"username": username.strip(), "password": password}, None
