from __future__ import annotations

from flask import Flask

from app.api.anime import anime_bp
from app.api.auth import auth_bp


def register_api(app: Flask) -> None:
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(anime_bp, url_prefix="/api/anime")
