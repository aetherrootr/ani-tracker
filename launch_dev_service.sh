#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="${TMPDIR:-/tmp}/ani-tracker"
BACKEND_PORT="3001"
FRONTEND_PORT="3000"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
FRONTEND_BIND_HOST="localhost"
ENABLE_LAN_DEV="0"
OIDC_ENV_FILE=""
POSTGRES_CONTAINER="ani-tracker-postgres"
POSTGRES_IMAGE="docker.io/library/postgres:17-alpine"
POSTGRES_DATA_DIR="${TMP_DIR}/postgres"
POSTGRES_HOST="127.0.0.1"
POSTGRES_PORT="54329"
POSTGRES_USER="ani_tracker"
POSTGRES_PASSWORD="ani_tracker"
POSTGRES_DB="ani_tracker"
DATABASE_URL="postgresql+psycopg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
REDIS_CONTAINER="ani-tracker-redis"
REDIS_IMAGE="docker.io/library/redis:7-alpine"
REDIS_DATA_DIR="${TMP_DIR}/redis"
REDIS_HOST="127.0.0.1"
REDIS_PORT="56379"
CELERY_BROKER_URL="redis://${REDIS_HOST}:${REDIS_PORT}/0"
ANIME_POSTER_STORAGE_DIR="${TMP_DIR}/anime-posters"
BACKEND_LOG="${TMP_DIR}/ani-tracker-backend.log"
FRONTEND_LOG="${TMP_DIR}/ani-tracker-frontend.log"
WORKER_LOG="${TMP_DIR}/ani-tracker-worker.log"
ANIME_POSTER_STORAGE_DIR="${TMP_DIR}/anime_posters"

mkdir -p "${TMP_DIR}"
mkdir -p "${POSTGRES_DATA_DIR}"
mkdir -p "${REDIS_DATA_DIR}"
mkdir -p "${ANIME_POSTER_STORAGE_DIR}"
mkdir -p "${ANIME_POSTER_STORAGE_DIR}"

backend_pid=""
frontend_pid=""
worker_pid=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--enable-lan-access] [--oidc-env-file FILE]

Options:
  --enable-lan-access  Allow LAN devices to access the frontend dev server.
  --oidc-env-file FILE Load OIDC environment variables for the backend from FILE.
  -h, --help Show this help message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --enable-lan-access)
      FRONTEND_BIND_HOST="0.0.0.0"
      ENABLE_LAN_DEV="1"
      shift
      ;;
    --oidc-env-file)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --oidc-env-file" >&2
        usage >&2
        exit 1
      fi
      OIDC_ENV_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "${OIDC_ENV_FILE}" && ! -f "${OIDC_ENV_FILE}" ]]; then
  echo "OIDC env file does not exist: ${OIDC_ENV_FILE}" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${frontend_pid}" ]] && kill -0 "${frontend_pid}" 2>/dev/null; then
    kill "${frontend_pid}"
  fi

  if [[ -n "${backend_pid}" ]] && kill -0 "${backend_pid}" 2>/dev/null; then
    kill "${backend_pid}"
  fi

  if [[ -n "${worker_pid}" ]] && kill -0 "${worker_pid}" 2>/dev/null; then
    kill "${worker_pid}"
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker stop "${POSTGRES_CONTAINER}" "${REDIS_CONTAINER}" >/dev/null 2>&1 || true
  fi
}

wait_for_url() {
  local url="$1"
  local name="$2"
  local pid="$3"
  local log_path="$4"

  for _ in {1..40}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      echo "${name} exited before becoming ready." >&2
      echo "Check ${name} log: ${log_path}" >&2
      return 1
    fi

    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  echo "${name} did not become ready: ${url}" >&2
  echo "Check ${name} log: ${log_path}" >&2
  return 1
}

ensure_url_is_free() {
  local url="$1"
  local name="$2"

  if curl -fsS "${url}" >/dev/null 2>&1; then
    echo "${name} already appears to be running at ${url}. Stop it before running this script." >&2
    exit 1
  fi
}

detect_lan_ip() {
  hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)' | head -n 1 || true
}

ensure_docker_available() {
  if ! command -v docker >/dev/null 2>&1; then
    cat >&2 <<EOF
Docker is required to start the local Postgres and Redis test containers.
Install Docker or another Docker-compatible container manager, then rerun this script.
EOF
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    cat >&2 <<EOF
Docker is installed but the Docker daemon is not reachable.
Start Docker or your Docker-compatible container manager, then rerun this script.
EOF
    exit 1
  fi
}

ensure_process_alive() {
  local pid="$1"
  local name="$2"
  local log_path="$3"

  if ! kill -0 "${pid}" 2>/dev/null; then
    echo "${name} exited unexpectedly." >&2
    echo "Check ${name} log: ${log_path}" >&2
    return 1
  fi
}

start_postgres() {
  ensure_docker_available

  local postgres_volume
  postgres_volume="${POSTGRES_DATA_DIR}:/var/lib/postgresql/data"
  if docker --version 2>/dev/null | grep -qi podman; then
    postgres_volume="${POSTGRES_DATA_DIR}:/var/lib/postgresql/data:Z,U"
  fi

  local existing_container
  existing_container="$(docker ps -aq -f "name=^/${POSTGRES_CONTAINER}$")"

  if [[ -n "${existing_container}" ]]; then
    if [[ "$(docker inspect -f '{{.State.Running}}' "${POSTGRES_CONTAINER}")" != "true" ]]; then
      echo "Recreating stopped Postgres container ${POSTGRES_CONTAINER}"
      docker rm "${POSTGRES_CONTAINER}" >/dev/null
      existing_container=""
    fi
  fi

  if [[ -z "${existing_container}" ]]; then
    echo "Creating Postgres container ${POSTGRES_CONTAINER}"
    docker run -d \
      --name "${POSTGRES_CONTAINER}" \
      -e POSTGRES_USER="${POSTGRES_USER}" \
      -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
      -e POSTGRES_DB="${POSTGRES_DB}" \
      -p "${POSTGRES_HOST}:${POSTGRES_PORT}:5432" \
      -v "${postgres_volume}" \
      "${POSTGRES_IMAGE}" >/dev/null
  else
    echo "Using running Postgres container ${POSTGRES_CONTAINER}"
  fi

  echo "Waiting for Postgres on ${POSTGRES_HOST}:${POSTGRES_PORT}"
  for _ in {1..80}; do
    if docker exec "${POSTGRES_CONTAINER}" pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  echo "Postgres did not become ready. Check container logs with: docker logs ${POSTGRES_CONTAINER}" >&2
  return 1
}

start_redis() {
  ensure_docker_available

  local redis_volume
  redis_volume="${REDIS_DATA_DIR}:/data"
  if docker --version 2>/dev/null | grep -qi podman; then
    redis_volume="${REDIS_DATA_DIR}:/data:Z,U"
  fi

  local existing_container
  existing_container="$(docker ps -aq -f "name=^/${REDIS_CONTAINER}$")"

  if [[ -n "${existing_container}" ]]; then
    if [[ "$(docker inspect -f '{{.State.Running}}' "${REDIS_CONTAINER}")" != "true" ]]; then
      echo "Recreating stopped Redis container ${REDIS_CONTAINER}"
      docker rm "${REDIS_CONTAINER}" >/dev/null
      existing_container=""
    fi
  fi

  if [[ -z "${existing_container}" ]]; then
    echo "Creating Redis container ${REDIS_CONTAINER}"
    docker run -d \
      --name "${REDIS_CONTAINER}" \
      -p "${REDIS_HOST}:${REDIS_PORT}:6379" \
      -v "${redis_volume}" \
      "${REDIS_IMAGE}" \
      redis-server --appendonly yes >/dev/null
  else
    echo "Using running Redis container ${REDIS_CONTAINER}"
  fi

  echo "Waiting for Redis on ${REDIS_HOST}:${REDIS_PORT}"
  for _ in {1..80}; do
    if docker exec "${REDIS_CONTAINER}" redis-cli ping >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  echo "Redis did not become ready. Check container logs with: docker logs ${REDIS_CONTAINER}" >&2
  return 1
}

requeue_pending_posters() {
  echo "Queueing pending poster downloads"
  DATABASE_URL="${DATABASE_URL}" \
  CELERY_BROKER_URL="${CELERY_BROKER_URL}" \
  ANIME_POSTER_STORAGE_DIR="${ANIME_POSTER_STORAGE_DIR}" \
  uv run python - <<'PY'
from sqlalchemy import select

from app import create_app
from app.db import get_db
from app.models.anime import AnimePoster
from app.services.anime_poster import enqueue_poster_download

app = create_app({"CREATE_TABLES": False})
with app.app_context():
    db = get_db()
    poster_ids = db.scalars(select(AnimePoster.id).where(AnimePoster.status == "pending")).all()
    for poster_id in poster_ids:
        enqueue_poster_download(poster_id)
    print(f"Queued {len(poster_ids)} pending poster download(s).")
PY
}

trap cleanup EXIT INT TERM

ensure_url_is_free "${BACKEND_URL}/api/auth/me" "Backend"
ensure_url_is_free "${FRONTEND_URL}/login" "Frontend"
start_postgres
start_redis

cat <<EOF
Integration environment logs:
Backend:  ${BACKEND_LOG}
Frontend: ${FRONTEND_LOG}
Worker:   ${WORKER_LOG}
EOF

echo "Starting Celery worker with Redis broker ${CELERY_BROKER_URL}"
DATABASE_URL="${DATABASE_URL}" \
CELERY_BROKER_URL="${CELERY_BROKER_URL}" \
ANIME_POSTER_STORAGE_DIR="${ANIME_POSTER_STORAGE_DIR}" \
uv run celery -A app.celery_app.celery_app worker --loglevel=info --pool=solo >"${WORKER_LOG}" 2>&1 &
worker_pid="$!"
sleep 1
ensure_process_alive "${worker_pid}" "Celery worker" "${WORKER_LOG}"
requeue_pending_posters

echo "Starting backend on ${BACKEND_URL}"
(
  if [[ -n "${OIDC_ENV_FILE}" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "${OIDC_ENV_FILE}"
    set +a
  fi

  export DATABASE_URL="${DATABASE_URL}"
  export CORS_ORIGIN="${FRONTEND_URL}"
  export CELERY_BROKER_URL="${CELERY_BROKER_URL}"
  export ANIME_POSTER_STORAGE_DIR="${ANIME_POSTER_STORAGE_DIR}"
  export SECRET_KEY="integration-test-secret"
  export OIDC_LOGIN_REDIRECT_URI="${OIDC_LOGIN_REDIRECT_URI:-${BACKEND_URL}/api/auth/oidc/callback}"
  export OIDC_LINK_REDIRECT_URI="${OIDC_LINK_REDIRECT_URI:-${BACKEND_URL}/api/auth/oidc/link/callback}"
  uv run python -m app.main
) >"${BACKEND_LOG}" 2>&1 &
backend_pid="$!"

wait_for_url "${BACKEND_URL}/api/auth/me" "Backend" "${backend_pid}" "${BACKEND_LOG}"

echo "Starting frontend on ${FRONTEND_URL}"
(
  cd "${ROOT_DIR}/web"
  ENABLE_LAN_DEV="${ENABLE_LAN_DEV}" pnpm exec next dev -H "${FRONTEND_BIND_HOST}" -p "${FRONTEND_PORT}"
) >"${FRONTEND_LOG}" 2>&1 &
frontend_pid="$!"

wait_for_url "${FRONTEND_URL}/login" "Frontend" "${frontend_pid}" "${FRONTEND_LOG}"

cat <<EOF
Integration environment is ready.

Frontend: ${FRONTEND_URL}
Backend:  ${BACKEND_URL}
Database: ${DATABASE_URL}
Redis:    ${CELERY_BROKER_URL}
Postgres data: ${POSTGRES_DATA_DIR}
Redis data:    ${REDIS_DATA_DIR}
Posters:       ${ANIME_POSTER_STORAGE_DIR}

Logs:
Backend:  ${BACKEND_LOG}
Frontend: ${FRONTEND_LOG}
Worker:   ${WORKER_LOG}
EOF

if [[ "${ENABLE_LAN_DEV}" == "1" ]]; then
  lan_ip="$(detect_lan_ip)"
  if [[ -n "${lan_ip}" ]]; then
    cat <<EOF

LAN access:
Frontend: http://${lan_ip}:${FRONTEND_PORT}
EOF
  else
    cat <<EOF

LAN access is enabled, but no LAN IP was detected automatically.
Run hostname -I and open http://<your-lan-ip>:${FRONTEND_PORT} from another device.
EOF
  fi
fi

echo ""
echo "Press Ctrl+C to stop both servers."

wait
