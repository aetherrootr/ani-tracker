#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-${ROOT_DIR}/dist}"
BUILD_DIR="${BUILD_DIR:-${ROOT_DIR}/.build}"
BACKEND_DIST="${DIST_DIR}/backend"
WEB_DIST="${DIST_DIR}/web"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

copy_if_exists() {
  local source_path="$1"
  local target_path="$2"
  if [[ -e "${source_path}" ]]; then
    cp -a "${source_path}" "${target_path}"
  fi
}

require_command uv
require_command pnpm

rm -rf "${BUILD_DIR}" "${DIST_DIR}"
mkdir -p "${BUILD_DIR}" "${BACKEND_DIST}" "${WEB_DIST}"

echo "Exporting backend runtime requirements"
uv export \
  --format requirements-txt \
  --no-dev \
  --no-emit-project \
  --no-hashes \
  --output-file "${BUILD_DIR}/requirements.txt"

echo "Building backend shiv archive"
uvx shiv \
  -r "${BUILD_DIR}/requirements.txt" \
  -o "${BACKEND_DIST}/ani-tracker.pyz" \
  -e app.main:main \
  "${ROOT_DIR}"
cp "${ROOT_DIR}/alembic.ini" "${BACKEND_DIST}/alembic.ini"
mkdir -p "${BACKEND_DIST}/app"
cp -a "${ROOT_DIR}/app/migrations" "${BACKEND_DIST}/app/migrations"

echo "Installing frontend dependencies"
pnpm --dir "${ROOT_DIR}/web" install --frozen-lockfile

echo "Building frontend standalone bundle"
pnpm --dir "${ROOT_DIR}/web" build

echo "Collecting frontend runtime files"
cp -a "${ROOT_DIR}/web/.next/standalone/." "${WEB_DIST}/"
mkdir -p "${WEB_DIST}/.next"
cp -a "${ROOT_DIR}/web/.next/static" "${WEB_DIST}/.next/static"
copy_if_exists "${ROOT_DIR}/web/public" "${WEB_DIST}/public"

cat <<EOF
Release artifacts written to ${DIST_DIR}

Backend shiv archive:
  ${BACKEND_DIST}/ani-tracker.pyz

Frontend standalone runtime:
  ${WEB_DIST}/server.js
EOF
