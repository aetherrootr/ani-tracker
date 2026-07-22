#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANIME_TRACKER_INSTANCE_PATH="/tmp/ani-tracker"
TMP_DIR="${ANIME_TRACKER_INSTANCE_PATH}"
BACKEND_PORT="3001"
FRONTEND_PORT="3000"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
FRONTEND_BIND_HOST="localhost"
ENABLE_LAN_DEV="0"
ENV_FILE=""
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
BACKEND_LOG="${TMP_DIR}/ani-tracker-backend.log"
FRONTEND_LOG="${TMP_DIR}/ani-tracker-frontend.log"
WORKER_LOG="${TMP_DIR}/ani-tracker-worker.log"
GUNICORN_TIMEOUT="120"
IMPORT_PROVIDER_TIMEOUT="80"
AUTO_IMPORT_TVDB_SEASONS_ENABLED="true"
AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED="true"

mkdir -p "${TMP_DIR}"
mkdir -p "${POSTGRES_DATA_DIR}"
mkdir -p "${REDIS_DATA_DIR}"

backend_pid=""
frontend_pid=""
worker_pid=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--enable-lan-access] [--env-file FILE] [--oidc-env-file FILE]

Options:
  --enable-lan-access  Allow LAN devices to access the frontend dev server.
  --env-file FILE      Load backend and worker environment variables from FILE.
  --oidc-env-file FILE Load OIDC environment variables after --env-file.
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
    --env-file)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for $1" >&2
        usage >&2
        exit 1
      fi
      ENV_FILE="$2"
      shift 2
      ;;
    --oidc-env-file)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for $1" >&2
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

if [[ -n "${ENV_FILE}" && ! -f "${ENV_FILE}" ]]; then
  echo "Env file does not exist: ${ENV_FILE}" >&2
  exit 1
fi

if [[ -n "${OIDC_ENV_FILE}" && ! -f "${OIDC_ENV_FILE}" ]]; then
  echo "OIDC env file does not exist: ${OIDC_ENV_FILE}" >&2
  exit 1
fi

cleanup() {
  terminate_process_tree "${frontend_pid}"
  terminate_process_tree "${backend_pid}"
  terminate_process_tree "${worker_pid}"

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker stop "${POSTGRES_CONTAINER}" "${REDIS_CONTAINER}" >/dev/null 2>&1 || true
  fi
}

terminate_process_tree() {
  local pid="$1"
  local child_pid

  if [[ -z "${pid}" ]] || ! kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi

  if command -v pgrep >/dev/null 2>&1; then
    while IFS= read -r child_pid; do
      terminate_process_tree "${child_pid}"
    done < <(pgrep -P "${pid}" 2>/dev/null || true)
  fi

  kill "${pid}" 2>/dev/null || true
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

source_env_file() {
  local env_file="$1"
  local line
  local key
  local value
  if [[ -z "${env_file}" ]]; then
    return 0
  fi
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == export\ * ]] && line="${line#export }"
    if [[ "${line}" != *=* ]]; then
      echo "Invalid env file line in ${env_file}" >&2
      return 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "Invalid environment variable name in ${env_file}: ${key}" >&2
      return 1
    fi
    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "${key}=${value}"
  done < "${env_file}"
}

load_env_files() {
  source_env_file "${ENV_FILE}"
  source_env_file "${OIDC_ENV_FILE}"
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
  (
    load_env_files
    export DATABASE_URL="${DATABASE_URL}"
    export CELERY_BROKER_URL="${CELERY_BROKER_URL}"
    export ANIME_TRACKER_INSTANCE_PATH="${ANIME_TRACKER_INSTANCE_PATH}"
    export IMPORT_PROVIDER_TIMEOUT="${IMPORT_PROVIDER_TIMEOUT}"
    uv run python - <<'PY'
from sqlalchemy import select

from app import create_app
from app.db import get_db
from app.models.anime import AnimePoster
from app.services.anime_poster import enqueue_poster_download

app = create_app()
with app.app_context():
    db = get_db()
    poster_ids = db.scalars(select(AnimePoster.id).where(AnimePoster.status == "pending")).all()
    for poster_id in poster_ids:
        enqueue_poster_download(poster_id)
    print(f"Queued {len(poster_ids)} pending poster download(s).")
PY
  )
}

trap cleanup EXIT INT TERM

ensure_url_is_free "${BACKEND_URL}/api/user/me" "Backend"
ensure_url_is_free "${FRONTEND_URL}/login" "Frontend"
start_postgres
start_redis

echo "Migrating database to latest Alembic revision"
DATABASE_URL="${DATABASE_URL}" uv run alembic upgrade head

cat <<EOF
Integration environment logs:
Backend:  ${BACKEND_LOG}
Frontend: ${FRONTEND_LOG}
Worker:   ${WORKER_LOG}
EOF

echo "Starting Celery worker with Redis broker ${CELERY_BROKER_URL}"
(
  load_env_files
  export DATABASE_URL="${DATABASE_URL}"
  export CELERY_BROKER_URL="${CELERY_BROKER_URL}"
  export ANIME_TRACKER_INSTANCE_PATH="${ANIME_TRACKER_INSTANCE_PATH}"
  export IMPORT_PROVIDER_TIMEOUT="${IMPORT_PROVIDER_TIMEOUT}"
  export AUTO_IMPORT_TVDB_SEASONS_ENABLED="${AUTO_IMPORT_TVDB_SEASONS_ENABLED}"
  export AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED="${AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED}"
  uv run python -m app.main worker --pool=solo
) >"${WORKER_LOG}" 2>&1 &
worker_pid="$!"
sleep 1
ensure_process_alive "${worker_pid}" "Celery worker" "${WORKER_LOG}"
requeue_pending_posters

echo "Starting backend on ${BACKEND_URL}"
(
  load_env_files
  export DATABASE_URL="${DATABASE_URL}"
  export CORS_ORIGIN="${FRONTEND_URL}"
  export CELERY_BROKER_URL="${CELERY_BROKER_URL}"
  export ANIME_TRACKER_INSTANCE_PATH="${ANIME_TRACKER_INSTANCE_PATH}"
  export GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT}"
  export IMPORT_PROVIDER_TIMEOUT="${IMPORT_PROVIDER_TIMEOUT}"
  export AUTO_IMPORT_TVDB_SEASONS_ENABLED="${AUTO_IMPORT_TVDB_SEASONS_ENABLED}"
  export AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED="${AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED}"
  export SECRET_KEY="integration-test-secret"
  uv run python -m app.main server --dev
) >"${BACKEND_LOG}" 2>&1 &
backend_pid="$!"

wait_for_url "${BACKEND_URL}/api/user/me" "Backend" "${backend_pid}" "${BACKEND_LOG}"

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
Instance path: ${ANIME_TRACKER_INSTANCE_PATH}

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
