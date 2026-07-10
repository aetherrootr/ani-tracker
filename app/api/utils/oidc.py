from __future__ import annotations

import hashlib
import re
import secrets
from typing import Any

from flask import current_app, jsonify, url_for
from flask.typing import ResponseReturnValue
from sqlalchemy import select

from app.api.utils.auth import hash_password
from app.models.user import DEFAULT_LANGUAGE_PREFERENCE, User, UserOidcIdentity

OIDC_AUTH_FAILED = "OIDC authentication failed"


def oidc_not_configured() -> ResponseReturnValue:
    return jsonify({"message": "OIDC is not configured"}), 404


def get_oidc_client() -> Any | None:
    if not current_app.config.get("OIDC_ENABLED"):
        return None
    return current_app.extensions.get("oidc_client")


def get_oidc_issuer() -> str:
    return str(current_app.config["OIDC_ISSUER"]).rstrip("/")


def get_oidc_redirect_uri(endpoint: str) -> str:
    endpoint_config = {
        "auth.oidc_callback": "OIDC_LOGIN_REDIRECT_URI",
        "auth.oidc_link_callback": "OIDC_LINK_REDIRECT_URI",
    }.get(endpoint)
    if endpoint_config:
        configured = current_app.config.get(endpoint_config)
        if configured:
            return str(configured)

    configured = current_app.config.get("OIDC_REDIRECT_URI")
    if configured and endpoint == "auth.oidc_callback":
        return str(configured)
    return url_for(endpoint, _external=True)


def fetch_oidc_claims(client: Any) -> tuple[dict[str, Any] | None, str | None]:
    try:
        token = client.authorize_access_token()
        claims = token.get("userinfo") if isinstance(token, dict) else None
        if claims is None and hasattr(client, "parse_id_token"):
            claims = client.parse_id_token(token)
        if claims is None and hasattr(client, "userinfo"):
            claims = client.userinfo(token=token)
    except Exception:  # noqa: BLE001
        return None, OIDC_AUTH_FAILED

    if not isinstance(claims, dict) or not claims.get("sub"):
        return None, "OIDC subject is missing"
    return claims, None


def create_oidc_user(db: Any, *, issuer: str, subject: str, claims: dict[str, Any]) -> User:
    email = _claim_str(claims, "email") or f"{_short_hash(issuer, subject, length=16)}@oidc.local"
    username = _unique_oidc_username(db, claims=claims, issuer=issuer, subject=subject, email=email)
    user = User(
        username=username,
        email=email,
        display_name=_oidc_display_name(claims, email),
        language_preference=DEFAULT_LANGUAGE_PREFERENCE,
        password_hash=hash_password(secrets.token_urlsafe(48)),
    )
    db.add(user)
    db.flush()
    db.add(create_oidc_identity(user_id=user.id, issuer=issuer, subject=subject, claims=claims))
    return user


def create_oidc_identity(
    *,
    user_id: int,
    issuer: str,
    subject: str,
    claims: dict[str, Any],
) -> UserOidcIdentity:
    return UserOidcIdentity(
        user_id=user_id,
        issuer=issuer,
        subject=subject,
        email=_claim_str(claims, "email"),
        preferred_username=_claim_str(claims, "preferred_username"),
    )


def _oidc_display_name(claims: dict[str, Any], email: str) -> str | None:
    return _claim_str(claims, "name") or _claim_str(claims, "preferred_username") or email.split("@", 1)[0]


def _unique_oidc_username(
    db: Any,
    *,
    claims: dict[str, Any],
    issuer: str,
    subject: str,
    email: str,
) -> str:
    base = _sanitize_username(_claim_str(claims, "preferred_username") or email.split("@", 1)[0])
    if base is None:
        base = f"oidc_{_short_hash(issuer, subject)}"

    candidates = [base, f"{base[:41]}_{_short_hash(issuer, subject)}"]
    for index in range(2, 100):
        candidates.append(f"{base[:46]}_{index}")

    for candidate in candidates:
        if db.scalar(select(User).where(User.username == candidate)) is None:
            return candidate
    return f"oidc_{_short_hash(issuer, subject, length=16)}"


def _sanitize_username(value: str | None) -> str | None:
    if value is None:
        return None
    username = re.sub(r"[^A-Za-z0-9_-]+", "_", value.strip()).strip("_-")[:50]
    if len(username) < 3 or re.fullmatch(r"[A-Za-z0-9_-]+", username) is None:
        return None
    return username


def _claim_str(claims: dict[str, Any], key: str) -> str | None:
    value = claims.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _short_hash(*parts: str, length: int = 10) -> str:
    return hashlib.sha256(":".join(parts).encode()).hexdigest()[:length]
