from __future__ import annotations

import os
import secrets
from pathlib import Path

from authlib.integrations.flask_client import OAuth
from flask import Flask, Response, request
from werkzeug.middleware.proxy_fix import ProxyFix

from app.api import register_api
from app.db import default_database_url, ensure_database_current, init_db
from app.import_provider import ImportProviderFactory
from app.tasks.celery_config import configure_celery
from app.utils import env_bool, env_float, env_int


def create_app(config: dict[str, object] | None = None) -> Flask:
    instance_path = os.environ.get("ANIME_TRACKER_INSTANCE_PATH")
    app = Flask(__name__, instance_path=instance_path) if instance_path else Flask(__name__)
    app.config.update(_build_app_config(app, config))
    if app.config["TRUST_PROXY"]:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)  # type: ignore[method-assign]

    if app.config["MIGRATE_DATABASE"]:
        ensure_database_current(str(app.config["DATABASE_URL"]))
    init_db(app)
    init_oidc(app)
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
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        return response

    return app


def _build_app_config(app: Flask, config: dict[str, object] | None = None) -> dict[str, object]:
    oidc_enabled = env_bool("OIDC_ENABLED") if os.environ.get("OIDC_ENABLED") is not None else None
    app_config: dict[str, object] = {
        # Core Flask and persistence settings used by the app factory and database layer.
        "DATABASE_URL": default_database_url(),
        "SECRET_KEY": os.environ.get("SECRET_KEY", "dev-secret-key-change-me"),
        "SESSION_COOKIE_HTTPONLY": True,
        "SESSION_COOKIE_SAMESITE": os.environ.get("SESSION_COOKIE_SAMESITE", "Lax"),
        "SESSION_COOKIE_SECURE": os.environ.get("FLASK_ENV") == "production",
        "MIGRATE_DATABASE": True,
        "TRUST_PROXY": env_bool("TRUST_PROXY"),

        # Browser integration settings for the Next.js frontend and session cookie API calls.
        "CORS_ORIGIN": os.environ.get("CORS_ORIGIN", "http://localhost:3000"),

        # Standard OIDC client settings. Complete issuer/client credentials enable SSO by default.
        "OIDC_ENABLED": oidc_enabled,
        "OIDC_ISSUER": os.environ.get("OIDC_ISSUER"),
        "OIDC_CLIENT_ID": os.environ.get("OIDC_CLIENT_ID"),
        "OIDC_CLIENT_SECRET": os.environ.get("OIDC_CLIENT_SECRET"),
        "OIDC_SCOPE": os.environ.get("OIDC_SCOPE", "openid email profile"),

        # Upstream anime metadata provider settings.
        "BANGUMI_API_BASE_URL": os.environ.get("BANGUMI_API_BASE_URL", "https://api.bgm.tv"),
        "BANGUMI_WEB_BASE_URL": os.environ.get("BANGUMI_WEB_BASE_URL", "https://bgm.tv"),
        "BANGUMI_USER_AGENT": os.environ.get(
            "BANGUMI_USER_AGENT",
            "ani-tracker/0.0.1 (https://github.com/aetherrootr/ani-tracker)",
        ),
        "TMDB_API_BASE_URL": os.environ.get("TMDB_API_BASE_URL", "https://api.themoviedb.org/3"),
        "TMDB_WEB_BASE_URL": os.environ.get("TMDB_WEB_BASE_URL", "https://www.themoviedb.org"),
        "TMDB_IMAGE_BASE_URL": os.environ.get("TMDB_IMAGE_BASE_URL", "https://image.tmdb.org/t/p"),
        "TMDB_POSTER_SIZE": os.environ.get("TMDB_POSTER_SIZE", "w500"),
        "TMDB_ACCESS_TOKEN": os.environ.get("TMDB_ACCESS_TOKEN"),
        "TMDB_API_KEY": os.environ.get("TMDB_API_KEY"),
        "TMDB_INCLUDE_ADULT": env_bool("TMDB_INCLUDE_ADULT"),
        "TVDB_API_BASE_URL": os.environ.get("TVDB_API_BASE_URL", "https://api4.thetvdb.com/v4"),
        "TVDB_WEB_BASE_URL": os.environ.get("TVDB_WEB_BASE_URL", "https://thetvdb.com"),
        "TVDB_API_KEY": os.environ.get("TVDB_API_KEY"),
        "TVDB_PIN": os.environ.get("TVDB_PIN"),
        "IMPORT_PROVIDER_TIMEOUT": env_float("IMPORT_PROVIDER_TIMEOUT", default=5, minimum=0),
        "IMPORT_SEARCH_TIMEOUT": env_float("IMPORT_SEARCH_TIMEOUT", default=15, minimum=0),

        # Poster download and local file storage limits.
        # TODO(aetherrootr): Deprecate ANIME_POSTER_STORAGE_DIR and use ANIME_TRACKER_INSTANCE_PATH/anime_posters only.
        "ANIME_POSTER_STORAGE_DIR": os.environ.get(
            "ANIME_POSTER_STORAGE_DIR",
            str(Path(app.instance_path) / "anime_posters"),
        ),
        "ANIME_POSTER_MAX_BYTES": env_int("ANIME_POSTER_MAX_BYTES", default=5 * 1024 * 1024, minimum=1),
        "ANIME_POSTER_REQUEST_TIMEOUT": env_float("ANIME_POSTER_REQUEST_TIMEOUT", default=5, minimum=0),
        "USER_WALLPAPER_STORAGE_DIR": os.environ.get(
            "USER_WALLPAPER_STORAGE_DIR",
            str(Path(app.instance_path) / "user_wallpapers"),
        ),
        "USER_WALLPAPER_MAX_BYTES": env_int("USER_WALLPAPER_MAX_BYTES", default=10 * 1024 * 1024, minimum=1),
        "USER_WALLPAPER_MAX_IMAGES_PER_USER": env_int("USER_WALLPAPER_MAX_IMAGES_PER_USER", default=12, minimum=1),
        # TODO(aetherrootr): Deprecate TVTIME_IMPORT_REPORT_DIR and use ANIME_TRACKER_INSTANCE_PATH/tvtime_import_reports only.
        "TVTIME_IMPORT_REPORT_DIR": os.environ.get(
            "TVTIME_IMPORT_REPORT_DIR",
            str(Path(app.instance_path) / "tvtime_import_reports"),
        ),
        "LIBRARY_REFRESH_JOB_LOCK_DIR": os.environ.get(
            "LIBRARY_REFRESH_JOB_LOCK_DIR",
            str(Path(app.instance_path) / "library_refresh_jobs"),
        ),

        # Celery runtime settings for background jobs.
        "CELERY_BROKER_URL": os.environ.get("CELERY_BROKER_URL", "memory://"),
        "CELERY_RESULT_BACKEND": os.environ.get("CELERY_RESULT_BACKEND"),
        "CELERY_TASK_ALWAYS_EAGER": env_bool("CELERY_TASK_ALWAYS_EAGER"),

        # Scheduled maintenance and synchronization settings.
        "ANIME_SYNC_CRON_HOUR": os.environ.get('ANIME_SYNC_CRON_HOUR', '4,12,20'),
        "ANIME_SYNC_CRON_MINUTE": env_int('ANIME_SYNC_CRON_MINUTE', default=0, minimum=0, maximum=59),
        "ANIME_SYNC_TIMEZONE": os.environ.get('ANIME_SYNC_TIMEZONE') or os.environ.get('TZ'),
        "UNTRACKED_ANIME_CLEANUP_DISABLED": env_bool('UNTRACKED_ANIME_CLEANUP_DISABLED', default=True),
        "UNTRACKED_ANIME_CLEANUP_CRON_MONTHS": os.environ.get('UNTRACKED_ANIME_CLEANUP_CRON_MONTHS'),
        "UNTRACKED_ANIME_CLEANUP_CRON_DAY": env_int('UNTRACKED_ANIME_CLEANUP_CRON_DAY', default=0, minimum=1, maximum=28),
        "UNTRACKED_ANIME_CLEANUP_CRON_HOUR": env_int('UNTRACKED_ANIME_CLEANUP_CRON_HOUR', default=-1, minimum=0, maximum=23),
        "UNTRACKED_ANIME_CLEANUP_CRON_MINUTE": env_int('UNTRACKED_ANIME_CLEANUP_CRON_MINUTE', default=-1, minimum=0, maximum=59),
        "AUTO_IMPORT_TVDB_SEASONS_ENABLED": env_bool('AUTO_IMPORT_TVDB_SEASONS_ENABLED'),
        "AUTO_IMPORT_TVDB_SEASONS_CRON_DAY": env_int('AUTO_IMPORT_TVDB_SEASONS_CRON_DAY', default=_random_cron_day(), minimum=1, maximum=28),
        "AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR": env_int('AUTO_IMPORT_TVDB_SEASONS_CRON_HOUR', default=_random_cron_hour(1, 3), minimum=0, maximum=23),
        "AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE": env_int('AUTO_IMPORT_TVDB_SEASONS_CRON_MINUTE', default=_random_cron_minute(), minimum=0, maximum=59),
        "AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED": env_bool('AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED'),
        "AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY": env_int('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_DAY', default=_random_cron_day(), minimum=1, maximum=28),
        "AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR": env_int('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_HOUR', default=_random_cron_hour(3, 5), minimum=0, maximum=23),
        "AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE": env_int('AUTO_IMPORT_BANGUMI_RELATED_ANIME_CRON_MINUTE', default=_random_cron_minute(), minimum=0, maximum=59),
    }
    if config is not None:
        # Test and local callers can override any environment-derived setting.
        app_config.update(config)

    # OIDC redirects back to the frontend after the backend callback finishes.
    cors_origin = str(app_config.get("CORS_ORIGIN") or "").rstrip("/")
    app_config["OIDC_POST_LOGIN_REDIRECT"] = f"{cors_origin}/tracking-list"
    app_config["OIDC_POST_LINK_REDIRECT"] = f"{cors_origin}/settings"
    app_config["OIDC_POST_PASSWORD_SETUP_REDIRECT"] = f"{cors_origin}/settings#settings-account"

    # If OIDC_ENABLED is not explicit, enable it only when the required client settings exist.
    if app_config.get("OIDC_ENABLED") is None:
        app_config["OIDC_ENABLED"] = all(
            app_config.get(key) for key in ("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET")
        )

    return app_config


def _random_cron_day() -> int:
    return secrets.randbelow(28) + 1


def _random_cron_hour(start: int, end: int) -> int:
    return secrets.randbelow(end - start + 1) + start


def _random_cron_minute() -> int:
    return secrets.randbelow(60)


def init_oidc(app: Flask) -> None:
    oauth = OAuth(app)
    app.extensions["oidc_oauth"] = oauth
    if not app.config.get("OIDC_ENABLED"):
        return

    issuer = str(app.config["OIDC_ISSUER"]).rstrip("/")
    app.extensions["oidc_client"] = oauth.register(
        name="oidc",
        client_id=app.config["OIDC_CLIENT_ID"],
        client_secret=app.config["OIDC_CLIENT_SECRET"],
        server_metadata_url=f"{issuer}/.well-known/openid-configuration",
        client_kwargs={"scope": app.config.get("OIDC_SCOPE", "openid email profile")},
    )
