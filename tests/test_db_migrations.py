from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from app import create_app


def test_create_app_migrates_empty_sqlite_database_to_head(test_instance_path) -> None:  # type: ignore[no-untyped-def]
    database_url = f"sqlite:///{test_instance_path / 'test.db'}"

    create_app(
        {
            "DATABASE_URL": database_url,
            "SECRET_KEY": "test-secret",
            "TESTING": True,
        },
    )

    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        assert "alembic_version" in inspector.get_table_names()
        with engine.connect() as connection:
            version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        assert version == "202607180001"
    finally:
        engine.dispose()


def test_init_db_does_not_create_schema_when_migrations_are_disabled(test_instance_path) -> None:  # type: ignore[no-untyped-def]
    database_url = f"sqlite:///{test_instance_path / 'test.db'}"

    create_app(
        {
            "DATABASE_URL": database_url,
            "MIGRATE_DATABASE": False,
            "SECRET_KEY": "test-secret",
            "TESTING": True,
        },
    )

    engine = create_engine(database_url)
    try:
        assert inspect(engine).get_table_names() == []
    finally:
        engine.dispose()
