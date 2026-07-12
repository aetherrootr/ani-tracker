ARG PYTHON_IMAGE=python:3.14-slim
ARG NODE_IMAGE=node:24-slim

FROM ${PYTHON_IMAGE} AS backend-builder

WORKDIR /src

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock README.md ./
COPY app ./app

RUN uv export \
    --format requirements-txt \
    --no-dev \
    --no-emit-project \
    --no-hashes \
    --output-file /tmp/requirements.txt \
  && mkdir -p /out \
  && uvx shiv \
    -r /tmp/requirements.txt \
    -o /out/ani-tracker.pyz \
    -e app.main:main \
    /src

FROM ${NODE_IMAGE} AS frontend-builder

WORKDIR /src/web

RUN corepack enable

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY web ./
RUN pnpm build \
  && mkdir -p /out/web/.next \
  && cp -a .next/standalone/. /out/web/ \
  && cp -a .next/static /out/web/.next/static \
  && if [ -d public ]; then cp -a public /out/web/public; fi

FROM ${NODE_IMAGE} AS node-runtime

FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONUNBUFFERED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    WEB_CONCURRENCY=2

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx \
  && rm -rf /var/lib/apt/lists/*

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=backend-builder /out/ani-tracker.pyz /opt/ani-tracker/backend/ani-tracker.pyz
COPY --from=frontend-builder /out/web /opt/ani-tracker/web
COPY alembic.ini /opt/ani-tracker/alembic.ini
COPY app/migrations /opt/ani-tracker/app/migrations
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /usr/local/bin/ani-tracker-entrypoint

RUN printf '%s\n' '#!/usr/bin/env sh' 'exec python /opt/ani-tracker/backend/ani-tracker.pyz "$@"' > /usr/local/bin/ani-tracker \
  && chmod +x /usr/local/bin/ani-tracker /usr/local/bin/ani-tracker-entrypoint \
  && mkdir -p /run/nginx /var/cache/nginx /opt/ani-tracker/instance

EXPOSE 8080

WORKDIR /opt/ani-tracker

CMD ["/usr/local/bin/ani-tracker-entrypoint"]
