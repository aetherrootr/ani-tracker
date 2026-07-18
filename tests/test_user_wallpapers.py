from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import create_app
from app.models.user import UserWallpaper

PNG = b"\x89PNG\r\n\x1a\n" + b"wallpaper"
PNG_TWO = b"\x89PNG\r\n\x1a\n" + b"second"
JPEG = b"\xff\xd8\xff" + b"wallpaper"
WEBP = b"RIFF\x08\x00\x00\x00WEBPwallpaper"


@pytest.fixture()
def app(test_instance_path: Path) -> Flask:
    return create_app(
        {
            "DATABASE_URL": f"sqlite:///{test_instance_path / 'test.db'}",
            "SECRET_KEY": "test-secret",
            "TESTING": True,
            "USER_WALLPAPER_MAX_BYTES": 1024,
            "USER_WALLPAPER_MAX_IMAGES_PER_USER": 3,
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


def register(client: FlaskClient, username: str = "link") -> None:
    response = client.post(
        "/api/auth/register",
        json={"username": username, "email": f"{username}@example.test", "password": "password123"},
    )
    assert response.status_code == 201


def upload(client: FlaskClient, variant: str, content: bytes, filename: str = "wallpaper.png"):
    return client.post(
        f"/api/user/me/wallpapers/{variant}",
        data={"file": (io.BytesIO(content), filename)},
        content_type="multipart/form-data",
    )


def test_manages_independent_collections_and_preferences(client: FlaskClient, db_session: Session) -> None:
    register(client)

    first = upload(client, "desktop", PNG).get_json()["user"]
    assert first["wallpaperUploadLimit"] == 3
    assert first["desktopWallpapers"][0]["selected"] is True
    assert first["mobileWallpapers"] == []

    second = upload(client, "desktop", PNG_TWO).get_json()["user"]
    second_id = second["desktopWallpapers"][1]["id"]
    assert len(second["desktopWallpapers"]) == 2
    assert second["desktopWallpapers"][1]["selected"] is False

    mobile = upload(client, "mobile", JPEG, "mobile.jpg").get_json()["user"]
    assert len(mobile["mobileWallpapers"]) == 1
    assert mobile["mobileWallpapers"][0]["selected"] is True

    preference = client.patch(
        "/api/user/me/wallpapers/desktop/preferences",
        json={"mode": "fixed", "selectedWallpaperId": second_id},
    )
    assert preference.status_code == 200
    assert [item["selected"] for item in preference.get_json()["user"]["desktopWallpapers"]] == [False, True]

    random_mode = client.patch("/api/user/me/wallpapers/desktop/preferences", json={"mode": "random"})
    assert random_mode.status_code == 200
    assert random_mode.get_json()["user"]["desktopWallpaperMode"] == "random"

    default_mode = client.patch("/api/user/me/wallpapers/desktop/preferences", json={"mode": "default"})
    assert default_mode.status_code == 200
    assert default_mode.get_json()["user"]["desktopWallpaperMode"] == "default"
    assert len(default_mode.get_json()["user"]["desktopWallpapers"]) == 2

    served = client.get(f"/api/user/me/wallpapers/desktop/{second_id}")
    assert served.status_code == 200
    assert served.data == PNG_TWO
    assert served.content_type == "image/png"
    assert served.headers["Cache-Control"] == "private, max-age=86400"

    removed = client.delete(f"/api/user/me/wallpapers/desktop/{second_id}")
    assert removed.status_code == 200
    assert len(removed.get_json()["user"]["desktopWallpapers"]) == 1
    assert removed.get_json()["user"]["desktopWallpapers"][0]["selected"] is True
    assert len(db_session.scalars(select(UserWallpaper)).all()) == 2


def test_enforces_shared_limit_and_rejects_duplicates(client: FlaskClient) -> None:
    register(client)
    assert upload(client, "desktop", PNG).status_code == 200
    assert upload(client, "desktop", PNG).status_code == 409
    assert upload(client, "desktop", PNG_TWO).status_code == 200
    assert upload(client, "mobile", JPEG).status_code == 200
    assert upload(client, "mobile", WEBP, "extra.webp").status_code == 409


def test_deleting_wallpaper_removes_its_file(client: FlaskClient, app: Flask) -> None:
    register(client)
    body = upload(client, "desktop", PNG).get_json()["user"]
    wallpaper_id = body["desktopWallpapers"][0]["id"]
    storage_dir = Path(str(app.config["USER_WALLPAPER_STORAGE_DIR"]))
    assert len(list(storage_dir.iterdir())) == 1

    assert client.delete(f"/api/user/me/wallpapers/desktop/{wallpaper_id}").status_code == 200
    assert list(storage_dir.iterdir()) == []


@pytest.mark.parametrize("content", [b"not an image", b""])
def test_rejects_invalid_images(client: FlaskClient, content: bytes) -> None:
    register(client)
    assert upload(client, "desktop", content).status_code == 400


def test_validates_requests_and_requires_authentication(client: FlaskClient) -> None:
    assert upload(client, "desktop", PNG).status_code == 401
    register(client)
    assert upload(client, "desktop", b"\x89PNG\r\n\x1a\n" + b"x" * 1024).status_code == 400
    assert client.post("/api/user/me/wallpapers/tablet").status_code == 404
    assert client.patch("/api/user/me/wallpapers/desktop/preferences", json={"mode": "daily"}).status_code == 400
    mobile_default = client.patch("/api/user/me/wallpapers/mobile/preferences", json={"mode": "default"})
    assert mobile_default.status_code == 200
    assert mobile_default.get_json()["user"]["mobileWallpaperMode"] == "default"
    assert client.patch("/api/user/me/wallpapers/desktop/preferences", json={"mode": "fixed", "selectedWallpaperId": 999}).status_code == 400


def test_serves_only_opted_in_wallpapers_as_public_login_background(client: FlaskClient) -> None:
    assert client.get("/api/auth/background/desktop").status_code == 404
    register(client)
    assert upload(client, "desktop", PNG).status_code == 200
    assert client.get("/api/auth/background/desktop").status_code == 404

    preference = client.patch("/api/user/me/preferences", json={"shareWallpapersOnLogin": True})
    assert preference.status_code == 200
    assert client.post("/api/auth/logout").status_code == 200

    background = client.get("/api/auth/background/desktop")
    assert background.status_code == 200
    assert background.data == PNG
    assert background.content_type == "image/png"
    assert background.headers["Cache-Control"] == "no-store"
    assert background.headers["X-Content-Type-Options"] == "nosniff"
    assert client.get("/api/auth/background/mobile").status_code == 404
    assert client.get("/api/auth/background/tablet").status_code == 404
