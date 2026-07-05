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
DATABASE_PATH="${TMP_DIR}/ani-tracker-integration.db"
BACKEND_LOG="${TMP_DIR}/ani-tracker-backend.log"
FRONTEND_LOG="${TMP_DIR}/ani-tracker-frontend.log"

mkdir -p "${TMP_DIR}"

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

trap cleanup EXIT INT TERM

ensure_url_is_free "${BACKEND_URL}/api/auth/me" "Backend"
ensure_url_is_free "${FRONTEND_URL}/login" "Frontend"

cat <<EOF
Integration environment logs:
Backend:  ${BACKEND_LOG}
Frontend: ${FRONTEND_LOG}
EOF

echo "Starting backend on ${BACKEND_URL}"
DATABASE_URL="sqlite:///${DATABASE_PATH}" \
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
Database: ${DATABASE_PATH}

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
