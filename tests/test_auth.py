from __future__ import annotations

from collections.abc import Iterator

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import create_app
from app.models.user import User


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


def register_user(client: FlaskClient, username: str = "link", email: str = "link@link.com"):
    return client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": "password123",
            "displayName": "Link",
        },
    )


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
        },
    }
    assert "password_hash" not in str(body)
    assert "Set-Cookie" in response.headers
    assert "HttpOnly" in response.headers["Set-Cookie"]

    user = db_session.scalar(select(User).where(User.username == "link"))
    assert user is not None
    assert user.password_hash != "password123"

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
