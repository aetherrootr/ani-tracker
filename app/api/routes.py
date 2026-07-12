from __future__ import annotations

from flask import Flask

from app.api.anime_assets import anime_assets_bp
from app.api.anime_episodes import anime_episodes_bp
from app.api.anime_info import anime_info_bp
from app.api.auth import auth_bp
from app.api.oidc import oidc_bp
from app.api.statistics import statistics_bp
from app.api.tvtime_import import tvtime_import_bp
from app.api.user import user_bp
from app.api.watch_state import watch_state_bp


def register_api(app: Flask) -> None:
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(user_bp, url_prefix="/api/user")
    app.register_blueprint(oidc_bp, url_prefix="/api/oidc")
    app.register_blueprint(anime_info_bp, url_prefix="/api/anime")
    app.register_blueprint(anime_episodes_bp, url_prefix="/api/anime")
    app.register_blueprint(watch_state_bp, url_prefix="/api/watch-state")
    app.register_blueprint(statistics_bp, url_prefix="/api/statistics")
    app.register_blueprint(anime_assets_bp, url_prefix="/api/anime")
    app.register_blueprint(tvtime_import_bp, url_prefix="/api/import")
