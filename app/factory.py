from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, Response, request

from app.api import register_api
from app.db import default_database_url, init_db
from app.import_provider import ImportProviderFactory
from app.tasks.celery_config import configure_celery
from app.utils import env_bool, env_float, env_int


def create_app(config: dict[str, object] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(
        DATABASE_URL=default_database_url(),
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-secret-key-change-me"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE=os.environ.get("SESSION_COOKIE_SAMESITE", "Lax"),
        SESSION_COOKIE_SECURE=os.environ.get("FLASK_ENV") == "production",
        CREATE_TABLES=True,
        CORS_ORIGIN=os.environ.get("CORS_ORIGIN", "http://localhost:3000"),
        BANGUMI_API_BASE_URL=os.environ.get("BANGUMI_API_BASE_URL", "https://api.bgm.tv"),
        BANGUMI_WEB_BASE_URL=os.environ.get("BANGUMI_WEB_BASE_URL", "https://bgm.tv"),
        BANGUMI_USER_AGENT=os.environ.get(
            "BANGUMI_USER_AGENT",
            "ani-tracker/0.0.1 (https://github.com/aetherrootr/ani-tracker)",
        ),
        IMPORT_PROVIDER_TIMEOUT=5.0,
        ANIME_POSTER_STORAGE_DIR=os.environ.get(
            "ANIME_POSTER_STORAGE_DIR",
            str(Path(app.instance_path) / "anime_posters"),
        ),
        ANIME_POSTER_MAX_BYTES=env_int("ANIME_POSTER_MAX_BYTES", default=5 * 1024 * 1024, minimum=1),
        ANIME_POSTER_REQUEST_TIMEOUT=env_float("ANIME_POSTER_REQUEST_TIMEOUT", default=5, minimum=0),
        CELERY_BROKER_URL=os.environ.get("CELERY_BROKER_URL", "memory://"),
        CELERY_RESULT_BACKEND=os.environ.get("CELERY_RESULT_BACKEND"),
        CELERY_TASK_ALWAYS_EAGER=env_bool("CELERY_TASK_ALWAYS_EAGER"),
        ANIME_SYNC_CRON_HOUR=env_int('ANIME_SYNC_CRON_HOUR', default=4, minimum=0, maximum=23),
        ANIME_SYNC_CRON_MINUTE=env_int('ANIME_SYNC_CRON_MINUTE', default=0, minimum=0, maximum=59),
        ANIME_SYNC_TIMEZONE=os.environ.get('ANIME_SYNC_TIMEZONE') or os.environ.get('TZ'),
    )
    if config is not None:
        app.config.update(config)

    init_db(app)
    configure_celery(app.config)
    app.extensions["import_provider_factory"] = ImportProviderFactory.from_config(app.config)
    register_api(app)

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        origin = app.config.get("CORS_ORIGIN")
        request_origin = request.headers.get("Origin")
        if origin and request_origin == origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
        return response

    return app
