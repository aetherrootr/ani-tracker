from __future__ import annotations

import os

from flask import Flask, current_app, g
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.models import Base


def init_db(app: Flask) -> None:
    database_url = app.config["DATABASE_URL"]
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    app.extensions["db_engine"] = engine
    app.extensions["db_session_factory"] = session_factory

    if app.config.get("CREATE_TABLES", True):
        Base.metadata.create_all(engine)

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
