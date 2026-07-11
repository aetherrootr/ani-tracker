from __future__ import annotations

from collections.abc import Iterator

import pytest
from flask import Flask, redirect
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import create_app
from app.models.user import User, UserOidcIdentity


@pytest.fixture()
def app(tmp_path) -> Flask:  # type: ignore[no-untyped-def]
    return create_app(
        {
            "DATABASE_URL": f"sqlite:///{tmp_path / 'test.db'}",
            "SECRET_KEY": "test-secret",
            "TESTING": True,
        },
    )


@pytest.fixture()
def client(app: Flask) -> FlaskClient:
    return app.test_client()


@pytest.fixture()
def db_session(app: Flask) -> Iterator[Session]:
    session_factory = app.extensions["db_session_factory"]
    with session_factory() as session:
        yield session


def register_user(
    client: FlaskClient,
    username: str = "link",
    email: str = "link@link.com",
    language_preference: str | None = None,
):
    payload = {
        "username": username,
        "email": email,
        "password": "password123",
        "displayName": "Link",
    }
    if language_preference is not None:
        payload["languagePreference"] = language_preference

    return client.post(
        "/api/auth/register",
        json=payload,
    )


class FakeOidcClient:
    def __init__(self, claims: dict[str, object]) -> None:
        self.claims = claims

    def authorize_redirect(self, redirect_uri: str):  # type: ignore[no-untyped-def]
        return redirect(redirect_uri)

    def authorize_access_token(self) -> dict[str, object]:
        return {"userinfo": self.claims}


def configure_oidc(app: Flask, claims: dict[str, object]) -> None:
    app.config.update(
        OIDC_ENABLED=True,
        OIDC_ISSUER="https://sso.example.test/application/o/ani-tracker/",
        OIDC_CLIENT_ID="ani-tracker",
        OIDC_CLIENT_SECRET="secret",
        OIDC_POST_LOGIN_REDIRECT="http://localhost:3000/tracking-list",
        OIDC_POST_LINK_REDIRECT="http://localhost:3000/settings",
    )
    app.extensions["oidc_client"] = FakeOidcClient(claims)


def test_register_creates_user_logs_in_and_never_returns_password_hash(
    client: FlaskClient,
    db_session: Session,
) -> None:
    response = register_user(client)

    assert response.status_code == 201
    body = response.get_json()
    assert body == {
        "user": {
            "id": 1,
            "username": "link",
            "displayName": "Link",
            "email": "link@link.com",
            "languagePreference": "zh-CN",
            "weekStartDay": 0,
            "oidcLinked": False,
        },
    }
    assert "password_hash" not in str(body)
    assert "Set-Cookie" in response.headers
    assert "HttpOnly" in response.headers["Set-Cookie"]

    user = db_session.scalar(select(User).where(User.username == "link"))
    assert user is not None
    assert user.password_hash != "password123"
    assert user.language_preference == "zh-CN"

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.get_json() == body


def test_duplicate_username_registration_fails(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201

    response = register_user(client, email="another@link.com")

    assert response.status_code == 409
    assert response.get_json() == {"message": "Username already exists"}


def test_duplicate_email_registration_is_allowed(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201

    response = register_user(client, username="zelda", email="link@link.com")

    assert response.status_code == 201
    assert response.get_json()["user"]["email"] == "link@link.com"


def test_register_accepts_language_preference(client: FlaskClient, db_session: Session) -> None:
    response = register_user(client, language_preference="en")

    assert response.status_code == 201
    assert response.get_json()["user"]["languagePreference"] == "en"

    user = db_session.scalar(select(User).where(User.username == "link"))
    assert user is not None
    assert user.language_preference == "en"


def test_login_success_and_wrong_password_failure(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201
    client.post("/api/auth/logout")

    response = client.post(
        "/api/auth/login",
        json={"username": "link", "password": "password123"},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["user"]["username"] == "link"
    assert "password_hash" not in str(body)

    client.post("/api/auth/logout")
    bad_response = client.post(
        "/api/auth/login",
        json={"username": "link", "password": "wrongpassword"},
    )
    assert bad_response.status_code == 401
    assert bad_response.get_json() == {"message": "Invalid username or password"}


def test_update_language_preference_requires_login_and_valid_language(client: FlaskClient) -> None:
    response = client.patch("/api/auth/me/language-preference", json={"languagePreference": "en"})
    assert response.status_code == 401

    assert register_user(client).status_code == 201

    invalid_response = client.patch(
        "/api/auth/me/language-preference",
        json={"languagePreference": "ja"},
    )
    assert invalid_response.status_code == 400
    assert invalid_response.get_json() == {"message": "Language preference is invalid"}

    update_response = client.patch(
        "/api/auth/me/language-preference",
        json={"languagePreference": "en"},
    )
    assert update_response.status_code == 200
    assert update_response.get_json()["user"]["languagePreference"] == "en"
    assert client.get("/api/auth/me").get_json()["user"]["languagePreference"] == "en"


def test_update_preferences_updates_week_start_day(client: FlaskClient, db_session: Session) -> None:
    response = client.patch("/api/auth/me/preferences", json={"weekStartDay": 6})
    assert response.status_code == 401

    assert register_user(client).status_code == 201

    invalid_response = client.patch("/api/auth/me/preferences", json={"weekStartDay": 7})
    assert invalid_response.status_code == 400
    assert invalid_response.get_json() == {"message": "Week start day is invalid"}

    update_response = client.patch("/api/auth/me/preferences", json={"weekStartDay": 6})

    assert update_response.status_code == 200
    assert update_response.get_json()["user"]["weekStartDay"] == 6
    user = db_session.scalar(select(User).where(User.username == "link"))
    assert user is not None
    assert user.week_start_day == 6


def test_logout_clears_current_user(client: FlaskClient) -> None:
    assert client.get("/api/auth/me").get_json() == {"user": None}
    assert register_user(client).status_code == 201

    logout_response = client.post("/api/auth/logout")

    assert logout_response.status_code == 200
    assert logout_response.get_json() == {"success": True}
    assert client.get("/api/auth/me").get_json() == {"user": None}


def test_validation_errors(client: FlaskClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={"username": "x", "email": "bad", "password": "short"},
    )
    assert response.status_code == 400
    assert "message" in response.get_json()

    login_response = client.post("/api/auth/login", json={"username": "", "password": ""})
    assert login_response.status_code == 400


def test_oidc_config_and_unconfigured_endpoints_do_not_fail(client: FlaskClient) -> None:
    assert client.get("/api/auth/oidc/config").get_json() == {"enabled": False}

    login_response = client.get("/api/auth/oidc/login")
    assert login_response.status_code == 404
    assert login_response.get_json() == {"message": "OIDC is not configured"}

    link_response = client.get("/api/auth/oidc/link")
    assert link_response.status_code == 404
    assert link_response.get_json() == {"message": "OIDC is not configured"}


def test_oidc_callback_auto_registers_user_and_identity(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    configure_oidc(
        app,
        {
            "sub": "authentik|user-1",
            "email": "sso@example.test",
            "preferred_username": "sso_user",
            "name": "SSO User",
        },
    )

    response = client.get("/api/auth/oidc/callback")

    assert response.status_code == 302
    assert response.headers["Location"] == "http://localhost:3000/tracking-list"
    user = db_session.scalar(select(User).where(User.username == "sso_user"))
    assert user is not None
    assert user.email == "sso@example.test"
    identity = db_session.scalar(select(UserOidcIdentity).where(UserOidcIdentity.user_id == user.id))
    assert identity is not None
    assert identity.subject == "authentik|user-1"
    assert client.get("/api/auth/me").get_json()["user"]["oidcLinked"] is True


def test_oidc_existing_identity_logs_in_original_user_without_duplicate(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    configure_oidc(app, {"sub": "same-sub", "email": "first@example.test", "preferred_username": "first"})
    assert client.get("/api/auth/oidc/callback").status_code == 302
    client.post("/api/auth/logout")

    configure_oidc(app, {"sub": "same-sub", "email": "changed@example.test", "preferred_username": "second"})
    assert client.get("/api/auth/oidc/callback").status_code == 302

    users = db_session.scalars(select(User)).all()
    identities = db_session.scalars(select(UserOidcIdentity)).all()
    assert len(users) == 1
    assert len(identities) == 1
    assert client.get("/api/auth/me").get_json()["user"]["username"] == "first"


def test_oidc_auto_register_does_not_merge_by_email(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client, username="local", email="shared@example.test").status_code == 201
    local_user = db_session.scalar(select(User).where(User.username == "local"))
    assert local_user is not None
    client.post("/api/auth/logout")
    configure_oidc(app, {"sub": "new-sub", "email": "shared@example.test", "preferred_username": "local"})

    assert client.get("/api/auth/oidc/callback").status_code == 302

    users = db_session.scalars(select(User).where(User.email == "shared@example.test")).all()
    assert len(users) == 2
    assert client.get("/api/auth/me").get_json()["user"]["id"] != local_user.id


def test_oidc_link_updates_me(
    app: Flask,
    client: FlaskClient,
) -> None:
    assert register_user(client).status_code == 201
    configure_oidc(app, {"sub": "link-sub", "email": "link-sso@example.test"})

    assert client.get("/api/auth/oidc/link").status_code == 302
    response = client.get("/api/auth/oidc/link/callback")

    assert response.status_code == 302
    assert response.headers["Location"] == "http://localhost:3000/settings"
    assert client.get("/api/auth/me").get_json()["user"]["oidcLinked"] is True


def test_oidc_unlink_requires_login(app: Flask, client: FlaskClient) -> None:
    configure_oidc(app, {"sub": "unlink-sub"})

    response = client.delete("/api/auth/oidc/link")

    assert response.status_code == 401
    assert response.get_json() == {"message": "Authentication required"}


def test_oidc_unlink_removes_current_user_identity(
    app: Flask,
    client: FlaskClient,
    db_session: Session,
) -> None:
    assert register_user(client).status_code == 201
    configure_oidc(app, {"sub": "unlink-sub", "email": "unlink@example.test"})
    assert client.get("/api/auth/oidc/link").status_code == 302
    assert client.get("/api/auth/oidc/link/callback").status_code == 302

    response = client.delete("/api/auth/oidc/link")

    assert response.status_code == 200
    assert response.get_json()["user"]["oidcLinked"] is False
    assert client.get("/api/auth/me").get_json()["user"]["oidcLinked"] is False
    assert db_session.scalar(select(UserOidcIdentity)) is None


def test_oidc_link_conflicts_when_identity_belongs_to_other_user(
    app: Flask,
    client: FlaskClient,
) -> None:
    configure_oidc(app, {"sub": "taken-sub", "email": "sso@example.test"})
    assert client.get("/api/auth/oidc/callback").status_code == 302
    client.post("/api/auth/logout")
    assert register_user(client, username="local", email="local@example.test").status_code == 201
    configure_oidc(app, {"sub": "taken-sub", "email": "sso@example.test"})

    assert client.get("/api/auth/oidc/link").status_code == 302
    response = client.get("/api/auth/oidc/link/callback")

    assert response.status_code == 409
    assert response.get_json() == {"message": "OIDC identity is already linked to another user"}


def test_oidc_link_conflicts_when_user_already_has_issuer_identity(
    app: Flask,
    client: FlaskClient,
) -> None:
    assert register_user(client).status_code == 201
    configure_oidc(app, {"sub": "first-sub", "email": "first@example.test"})
    assert client.get("/api/auth/oidc/link").status_code == 302
    assert client.get("/api/auth/oidc/link/callback").status_code == 302
    configure_oidc(app, {"sub": "second-sub", "email": "second@example.test"})

    assert client.get("/api/auth/oidc/link").status_code == 302
    response = client.get("/api/auth/oidc/link/callback")

    assert response.status_code == 409
    assert response.get_json() == {"message": "User already has an OIDC identity for this issuer"}
