# ani-tracker

## Development

Run the application:

```bash
uv run python -m app.main
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
uv run ruff check app
```

Run type checks:

```bash
uv run mypy app
```

Run tests:

```bash
uv run pytest
```
