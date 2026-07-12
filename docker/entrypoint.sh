#!/usr/bin/env bash

set -euo pipefail

backend_pid=""
frontend_pid=""
nginx_pid=""

cleanup() {
  local pid
  for pid in "${nginx_pid}" "${frontend_pid}" "${backend_pid}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

export API_PROXY_TARGET="${API_PROXY_TARGET:-http://127.0.0.1:3001}"
export HOSTNAME="${NEXT_HOST:-127.0.0.1}"
export PORT="${NEXT_PORT:-3000}"

echo "Starting backend shiv app on 0.0.0.0:3001"
python /opt/ani-tracker/backend/ani-tracker.pyz server --prod &
backend_pid="$!"

echo "Starting Next standalone server on ${HOSTNAME}:${PORT}"
(
  cd /opt/ani-tracker/web
  node server.js
) &
frontend_pid="$!"

echo "Starting nginx on 0.0.0.0:8080"
nginx -g 'daemon off;' &
nginx_pid="$!"

wait -n "${backend_pid}" "${frontend_pid}" "${nginx_pid}"
exit_code="$?"
cleanup
exit "${exit_code}"
