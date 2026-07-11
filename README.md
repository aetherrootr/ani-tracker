# ani-tracker

## Development

Run the application:

```bash
uv run python -m app.main
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
