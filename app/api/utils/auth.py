from __future__ import annotations

import re
from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import jsonify, session as flask_session
from flask.typing import ResponseReturnValue
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash, generate_password_hash

from app.db import get_db
from app.models.user import DEFAULT_LANGUAGE_PREFERENCE, User

USERNAME_RE = re.compile(r'^[A-Za-z0-9_-]+$')
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
SUPPORTED_LANGUAGE_PREFERENCES = {'zh-CN', 'en'}


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    return check_password_hash(password_hash, password)


def get_current_user(db: Session) -> User | None:
    user_id = flask_session.get('user_id')
    if not isinstance(user_id, int):
        return None
    user = db.get(User, user_id)
    if user is None:
        flask_session.clear()
    return user


def require_auth_user[**P, R: ResponseReturnValue](
    view: Callable[Concatenate[Session, User, P], R],
) -> Callable[P, ResponseReturnValue]:
    @wraps(view)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> ResponseReturnValue:
        db = get_db()
        user = get_current_user(db)
        if user is None:
            return jsonify({'message': 'Authentication required'}), 401
        return view(db, user, *args, **kwargs)

    return wrapped


def user_to_auth_dict(user: User) -> dict[str, object]:
    return {
        'id': user.id,
        'username': user.username,
        'displayName': user.display_name,
        'email': user.email,
        'languagePreference': user.language_preference,
        'importProviderPreference': user.import_provider_preference,
        'weekStartDay': user.week_start_day,
        'oidcLinked': bool(user.oidc_identities),
    }


def validate_register_payload(data: object) -> tuple[dict[str, str | None] | None, str | None]:
    if not isinstance(data, dict):
        return None, 'Request body must be a JSON object'

    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    display_name = data.get('displayName')
    language_preference = data.get('languagePreference')

    if not isinstance(username, str) or not username.strip():
        return None, 'Username is required'
    username = username.strip()
    if len(username) < 3 or len(username) > 50:
        return None, 'Username must be between 3 and 50 characters'
    if USERNAME_RE.fullmatch(username) is None:
        return None, 'Username may only contain letters, numbers, underscores, and hyphens'

    if not isinstance(email, str) or not email.strip():
        return None, 'Email is required'
    email = email.strip()
    if EMAIL_RE.fullmatch(email) is None:
        return None, 'Email is invalid'

    if not isinstance(password, str) or not password:
        return None, 'Password is required'
    if len(password) < 8:
        return None, 'Password must be at least 8 characters'

    if display_name is not None:
        if not isinstance(display_name, str):
            return None, 'Display name is invalid'
        display_name = display_name.strip() or None
        if display_name is not None and len(display_name) > 100:
            return None, 'Display name must be at most 100 characters'

    if language_preference is None:
        language_preference = DEFAULT_LANGUAGE_PREFERENCE
    elif not isinstance(language_preference, str) or language_preference not in SUPPORTED_LANGUAGE_PREFERENCES:
        return None, 'Language preference is invalid'

    return {
        'username': username,
        'email': email,
        'password': password,
        'display_name': display_name,
        'language_preference': language_preference,
    }, None


def validate_login_payload(data: object) -> tuple[dict[str, str] | None, str | None]:
    if not isinstance(data, dict):
        return None, 'Request body must be a JSON object'

    username = data.get('username')
    password = data.get('password')

    if not isinstance(username, str) or not username.strip():
        return None, 'Username is required'
    if not isinstance(password, str) or not password:
        return None, 'Password is required'

    return {'username': username.strip(), 'password': password}, None


def validate_language_preference_payload(data: object) -> tuple[str | None, str | None]:
    if not isinstance(data, dict):
        return None, 'Request body must be a JSON object'

    language_preference = data.get('languagePreference')
    if not isinstance(language_preference, str) or language_preference not in SUPPORTED_LANGUAGE_PREFERENCES:
        return None, 'Language preference is invalid'

    return language_preference, None


def validate_week_start_day_payload(data: object) -> tuple[int | None, str | None]:
    if not isinstance(data, dict):
        return None, 'Request body must be a JSON object'

    week_start_day = data.get('weekStartDay')
    if not isinstance(week_start_day, int) or week_start_day < 0 or week_start_day > 6:
        return None, 'Week start day is invalid'

    return week_start_day, None


def validate_import_provider_preference_payload(data: object, available_providers: set[str]) -> tuple[str | None, str | None]:
    if not isinstance(data, dict):
        return None, 'Request body must be a JSON object'

    provider = data.get('importProviderPreference')
    if not isinstance(provider, str) or provider not in available_providers:
        return None, 'Import provider preference is invalid'

    return provider, None
