from __future__ import annotations

from alembic import command
from alembic.config import Config
from sqlalchemy import Integer, create_engine, inspect, text

from app import create_app
from app.db import alembic_config_path


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
        assert version == "202608050001"
        assert "anime_poster_resource" in inspector.get_table_names()
        poster_columns = {column["name"] for column in inspector.get_columns("anime_poster")}
        assert {"resource_id", "role", "priority"} <= poster_columns
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
        assert {
            'ix_episode_anime_id_air_at',
            'ix_episode_provider_external_id',
            'ix_episode_status_status_air_at',
        } <= episode_indexes
        snapshot_episode_indexes = {
            index['name'] for index in inspector.get_indexes('user_anime_metadata_episode_snapshot')
        }
        assert 'ix_user_anime_metadata_episode_snapshot_snapshot_air_at' in snapshot_episode_indexes
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


def test_poster_resource_migration_deduplicates_existing_urls(test_instance_path) -> None:  # type: ignore[no-untyped-def]
    database_url = f"sqlite:///{test_instance_path / 'poster-migration.db'}"
    create_app({'DATABASE_URL': database_url, 'SECRET_KEY': 'test-secret', 'TESTING': True})
    engine = create_engine(database_url)
    config = Config(str(alembic_config_path()))
    try:
        with engine.begin() as connection:
            config.attributes['connection'] = connection
            command.downgrade(config, '202607230001')
            connection.execute(
                text(
                    "INSERT INTO anime_meta_info (id, provider_type, external_id, original_name) VALUES "
                    "(1, 'tvdb', '321:1', 'Season 1'), (2, 'tvdb', '321:2', 'Season 2')",
                ),
            )
            connection.execute(
                text(
                    "INSERT INTO anime_poster "
                    "(id, anime_id, storage_path, source_url, status) VALUES "
                    "(1, 1, 'season-1-series.jpg', 'https://example.test/series.jpg', 'ready'), "
                    "(2, 2, 'season-2-series.jpg', 'https://example.test/series.jpg', 'pending')",
                ),
            )
            command.upgrade(config, 'head')

        with engine.connect() as connection:
            assert connection.execute(text('SELECT count(*) FROM anime_poster_resource')).scalar_one() == 1
            rows = connection.execute(text('SELECT anime_id, resource_id FROM anime_poster ORDER BY anime_id')).all()
            assert rows == [(1, 1), (2, 1)]
            resource = connection.execute(
                text('SELECT storage_path, status FROM anime_poster_resource'),
            ).one()
            assert resource == ('season-1-series.jpg', 'ready')
    finally:
        engine.dispose()
