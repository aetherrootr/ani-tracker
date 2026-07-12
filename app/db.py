from __future__ import annotations

import os
import threading
from pathlib import Path

from alembic import command
from alembic.config import Config
from flask import Flask, current_app, g
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

_MIGRATION_LOCK_KEY = 1_487_207_031
_migrated_database_urls: set[str] = set()
_migration_lock = threading.Lock()


def init_db(app: Flask) -> None:
    database_url = app.config["DATABASE_URL"]
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    app.extensions["db_engine"] = engine
    app.extensions["db_session_factory"] = session_factory

    @app.teardown_appcontext
    def close_db(_error: BaseException | None = None) -> None:
        db = g.pop("db_session", None)
        if db is not None:
            db.close()


def get_db() -> Session:
    db = g.get("db_session")
    if db is None:
        session_factory = current_app.extensions["db_session_factory"]
        db = session_factory()
        g.db_session = db
    return db


def get_engine(app: Flask) -> Engine:
    return app.extensions["db_engine"]


def default_database_url() -> str:
    return os.environ.get("DATABASE_URL", "sqlite:///ani_tracker.db")


def ensure_database_current(database_url: str) -> None:
    with _migration_lock:
        if database_url in _migrated_database_urls:
            return
        upgrade_database(database_url)
        _migrated_database_urls.add(database_url)


def upgrade_database(database_url: str) -> None:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, connect_args=connect_args)
    try:
        with engine.begin() as connection:
            is_postgres = make_url(database_url).get_backend_name().startswith("postgresql")
            if is_postgres:
                connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": _MIGRATION_LOCK_KEY})
            try:
                alembic_config = Config(str(alembic_config_path()))
                alembic_config.attributes["connection"] = connection
                command.upgrade(alembic_config, "head")
            finally:
                if is_postgres:
                    connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _MIGRATION_LOCK_KEY})
    finally:
        engine.dispose()


def alembic_config_path() -> Path:
    configured_path = os.environ.get('ALEMBIC_CONFIG')
    candidates = [
        Path(configured_path) if configured_path else None,
        Path.cwd() / 'alembic.ini',
        Path(__file__).resolve().parent.parent / 'alembic.ini',
    ]

    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate

    return Path(__file__).resolve().parent.parent / 'alembic.ini'
