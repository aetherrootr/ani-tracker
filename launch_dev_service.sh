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
POSTGRES_CONTAINER="ani-tracker-postgres"
POSTGRES_IMAGE="docker.io/library/postgres:17-alpine"
POSTGRES_DATA_DIR="${TMP_DIR}/postgres"
POSTGRES_HOST="127.0.0.1"
POSTGRES_PORT="54329"
POSTGRES_USER="ani_tracker"
POSTGRES_PASSWORD="ani_tracker"
POSTGRES_DB="ani_tracker"
DATABASE_URL="postgresql+psycopg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
BACKEND_LOG="${TMP_DIR}/ani-tracker-backend.log"
FRONTEND_LOG="${TMP_DIR}/ani-tracker-frontend.log"

mkdir -p "${TMP_DIR}"
mkdir -p "${POSTGRES_DATA_DIR}"

backend_pid=""
frontend_pid=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--enable-lan-access]

Options:
  --enable-lan-access  Allow LAN devices to access the frontend dev server.
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

cleanup() {
  if [[ -n "${frontend_pid}" ]] && kill -0 "${frontend_pid}" 2>/dev/null; then
    kill "${frontend_pid}"
  fi

  if [[ -n "${backend_pid}" ]] && kill -0 "${backend_pid}" 2>/dev/null; then
    kill "${backend_pid}"
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
Docker is required to start the local Postgres test database.
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

trap cleanup EXIT INT TERM

ensure_url_is_free "${BACKEND_URL}/api/auth/me" "Backend"
ensure_url_is_free "${FRONTEND_URL}/login" "Frontend"
start_postgres

cat <<EOF
Integration environment logs:
Backend:  ${BACKEND_LOG}
Frontend: ${FRONTEND_LOG}
EOF

echo "Starting backend on ${BACKEND_URL}"
DATABASE_URL="${DATABASE_URL}" \
CORS_ORIGIN="${FRONTEND_URL}" \
SECRET_KEY="integration-test-secret" \
uv run python -m app.main >"${BACKEND_LOG}" 2>&1 &
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
Postgres data: ${POSTGRES_DATA_DIR}

Logs:
Backend:  ${BACKEND_LOG}
Frontend: ${FRONTEND_LOG}
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
