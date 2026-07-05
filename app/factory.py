from __future__ import annotations

import os

from flask import Flask, Response, request

from app.api import register_api
from app.db import default_database_url, init_db
from app.import_provider import ImportProviderFactory


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
        BANGUMI_USER_AGENT=os.environ.get(
            "BANGUMI_USER_AGENT",
            "ani-tracker/0.0.1 (https://github.com/aetherrootr/ani-tracker)",
        ),
        IMPORT_PROVIDER_TIMEOUT=5.0,
    )
    if config is not None:
        app.config.update(config)

    init_db(app)
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
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return response

    return app
