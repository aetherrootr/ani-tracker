# ani-tracker

## Development

Run the application:

```bash
uv run python -m app.main
```

The backend runs in production mode with Gunicorn by default. Use `--prod` to
select production mode explicitly, or `--dev` to run the Flask development
server:

```bash
uv run python -m app.main --prod
uv run python -m app.main --dev
```

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
  ani-tracker:local
```

The container exposes nginx on `8080`, serves the Next frontend at `/`, and
proxies `/api/` to the shiv/Gunicorn backend. Override `WEB_CONCURRENCY` to tune
Gunicorn workers.

Run the full production stack with Docker Compose:

```bash
cp env.example .env
docker compose up --build
```

The compose stack starts the application container together with PostgreSQL and
Redis. The app is exposed at `http://localhost:8080` by default.

Run lint checks:

```bash
uv run ruff check app tests migrations
```

Run type checks:

```bash
uv run mypy app
```

Run tests:

```bash
uv run pytest
```
