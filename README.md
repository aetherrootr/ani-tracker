# ani-tracker

[![Status](https://img.shields.io/badge/status-early%20stage-orange)](#project-status)
[![Docker Compose](https://img.shields.io/badge/docker-compose-blue)](docker-compose.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

ani-tracker is a local-first tracker for anime episodes. It can also be used to
track TV shows and movies.

ani-tracker is designed as a self-hostable alternative to
[TV Time](https://tvtime.com/). Its interaction model is
inspired by TV Time and Apple Music.

## Screenshots

### Desktop

| Search | Library |
| --- | --- |
| ![Desktop search](docs/search-desktop.png) | ![Desktop library](docs/library-desktop.png) |

| Watchlist | Stats |
| --- | --- |
| ![Desktop watchlist](docs/watchlist-desktop.png) | ![Desktop stats](docs/stats-desktop.png) |

### Mobile

<p>
  <img src="docs/search-mobile.png" alt="Mobile search" width="180">
  <img src="docs/library-mobile.png" alt="Mobile library" width="180">
  <img src="docs/watchlist-mobile-0.png" alt="Mobile watchlist" width="180">
  <img src="docs/watchlist-mobile-1.png" alt="Mobile watchlist detail" width="180">
  <img src="docs/stats-mobile.png" alt="Mobile stats" width="180">
</p>

## Project Status

ani-tracker is in early development. Core tracking features are usable, but APIs,
migrations, UI details, and metadata-provider behavior may still change.

The project is built with AI assistance, with architecture design and code review
handled by a human maintainer.

## Features

- Local-first: all user data is stored locally. Network access is only used to
  fetch metadata from upstream services.
- Multiple metadata providers: choose the provider you prefer for each title.
  Current providers include [Bangumi](https://bangumi.tv/),
  [TheTVDB](https://www.thetvdb.com/), and
  [TMDB](https://www.themoviedb.org/).
- Metadata provenance control: to keep the design simple and predictable,
  each title is linked to one upstream metadata provider at a time. This avoids
  silently mixing data from different providers, and ani-tracker provides a way
  to migrate your watch history when switching providers.
- Desktop and mobile experiences: ani-tracker implements separate frontend
  interactions for desktop and mobile devices.
- OIDC support.

## Quick Start

Run the full production stack with Docker Compose:

```bash
cp env.example .env
docker compose up --build
```

The compose stack starts the web application, a Celery worker, PostgreSQL, and
Redis. The app is exposed at `http://localhost:8080` by default. Change
`APP_PORT` in `.env` if you want to use another port.

## Metadata Providers

| Provider | Status | Notes |
| --- | --- | --- |
| [Bangumi](https://bangumi.tv/) | Supported | Anime-focused metadata |
| [TheTVDB](https://www.thetvdb.com/) | Supported | TV metadata |
| [TMDB](https://www.themoviedb.org/) | Supported | TV and movie metadata |

## Configuration

Copy `env.example` to `.env` before running Docker Compose. Common settings:

| Variable | Description |
| --- | --- |
| `APP_PORT` | Public HTTP port. Defaults to `8080`. |
| `SECRET_KEY` | Flask session secret. Change this before deployment. |
| `POSTGRES_DB` | PostgreSQL database name. |
| `POSTGRES_USER` | PostgreSQL username. |
| `POSTGRES_PASSWORD` | PostgreSQL password. Change this before deployment. |
| `ANIME_TRACKER_INSTANCE_PATH` | Persistent app instance directory. Defaults to `/var/lib/ani-tracker` in production containers. |
| `TMDB_API_KEY` | Optional TMDB API key. |
| `TMDB_ACCESS_TOKEN` | Optional TMDB access token. |
| `TVDB_API_KEY` | Optional TheTVDB API key. |
| `OIDC_ENABLED` | Enables optional OIDC / SSO integration. |

## Non-goals

- ani-tracker does not manage local media files.
- ani-tracker is not a download, streaming, or media-server application.
- ani-tracker does not aim to be a social network.

## Known Limitations

- Metadata-provider behavior may change during early development.
- Import and export tools are still under development.
- Some UI interactions may be refined in future releases.

## Roadmap

- Support importing data from TV Time.
- Support data export.
- Support custom background images to improve the frontend experience.
- Support AniList as a metadata provider.
- Support configuring streaming platforms for titles, allowing ani-tracker to
  link from a title to the platform where it can be watched.

## Development

Run the backend application:

```bash
uv run python -m app.main server
```

The backend server runs in production mode with Gunicorn by default. Use
`--prod` to select production mode explicitly, or `--dev` to run the Flask
development server:

```bash
uv run python -m app.main server --prod
uv run python -m app.main server --dev
```

Run a Celery worker for background jobs:

```bash
uv run python -m app.main worker
```

Extra Celery worker arguments are passed through, for example
`uv run python -m app.main worker --pool=solo`.

Database schema is managed by Alembic. Application startup upgrades the database
to the latest migration by default.

Run migrations manually:

```bash
DATABASE_URL=sqlite:///ani_tracker.db uv run alembic upgrade head
```

Create a new migration after model changes:

```bash
DATABASE_URL=sqlite:///ani_tracker.db uv run alembic revision --autogenerate -m "message"
```

Inspect or upgrade an environment:

```bash
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/ani_tracker uv run alembic current
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/ani_tracker uv run alembic upgrade head
```

Run a local frontend/backend integration environment:

```bash
./launch_dev_service.sh
```

The script starts the backend at `http://localhost:3001` and the frontend at
`http://localhost:3000`, configures credentialed CORS for the frontend origin,
starts Docker Postgres and Redis containers, and starts a Celery worker for
background jobs such as poster downloads. Postgres data is mounted under
`/tmp/ani-tracker/postgres` and Redis data under `/tmp/ani-tracker/redis`. Press
`Ctrl+C` to stop the app servers and worker. Docker or a Docker-compatible
container manager must be installed and running.

Build production release artifacts:

```bash
scripts/build_release.sh
```

The release script builds `dist/backend/ani-tracker.pyz` with shiv and
`dist/web/server.js` with Next standalone output.

Build and run the single-container production image:

```bash
docker build -t ani-tracker:local .
docker run --rm -p 8080:8080 \
  -e SECRET_KEY=change-me \
  -e DATABASE_URL=postgresql+psycopg://user:password@host:5432/ani_tracker \
  -e ANIME_TRACKER_INSTANCE_PATH=/var/lib/ani-tracker \
  -v ani_tracker_data:/var/lib/ani-tracker \
  ani-tracker:local
```

The container exposes nginx on `8080`, serves the Next frontend at `/`, and
proxies `/api/` to the shiv/Gunicorn backend. Override `WEB_CONCURRENCY` to tune
Gunicorn workers. Run a separate container with `ani-tracker.pyz worker` for
background jobs, or use Docker Compose to start both services.

Reset a user's password from inside the container:

```bash
ani-tracker reset-password <username>
```

This sets a random 12-character password and prints it to stdout.

Run lint checks:

```bash
uv run ruff check .
```

Run type checks:

```bash
uv run mypy .
```

Run tests:

```bash
uv run pytest
```

## Contributing

Issues and discussions are welcome. The project is still evolving, so please open
an issue before starting large changes.

## License

ani-tracker is licensed under the [Apache License 2.0](LICENSE).

## Documentation

- [中文 README](docs/README.zh-CN.md)
