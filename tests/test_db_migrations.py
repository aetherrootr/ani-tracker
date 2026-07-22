from __future__ import annotations

from sqlalchemy import Integer, create_engine, inspect, text

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
        assert version == "202607230001"
        assert "user_wallpapers" in inspector.get_table_names()
        assert "anime_relation_title" in inspector.get_table_names()
        assert "provider_sync_cursor" in inspector.get_table_names()
        cursor_columns = {column["name"] for column in inspector.get_columns("provider_sync_cursor")}
        assert "cursor_page" in cursor_columns
        user_columns = {column["name"]: column for column in inspector.get_columns("users")}
        assert {
            "desktop_wallpaper_mode",
            "mobile_wallpaper_mode",
            "share_wallpapers_on_login",
            "wallpaper_glass_style",
            "wallpaper_glass_intensity",
        } <= user_columns.keys()
        assert isinstance(user_columns["wallpaper_glass_intensity"]["type"], Integer)
        episode_columns = {column["name"] for column in inspector.get_columns("episode")}
        snapshot_episode_columns = {column["name"] for column in inspector.get_columns("user_anime_metadata_episode_snapshot")}
        assert "air_at_has_time" in episode_columns
        assert {'provider_external_id', 'status_air_at'} <= episode_columns
        assert "air_at_has_time" in snapshot_episode_columns
        episode_indexes = {index['name'] for index in inspector.get_indexes('episode')}
        assert {'ix_episode_provider_external_id', 'ix_episode_status_status_air_at'} <= episode_indexes
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
