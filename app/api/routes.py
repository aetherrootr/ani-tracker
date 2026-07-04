from __future__ import annotations

from flask import Flask

from app.api.auth import auth_bp


def register_api(app: Flask) -> None:
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
