# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS production-dependencies

WORKDIR /build

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --workspace=backend --include-workspace-root=false

FROM node:${NODE_VERSION} AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5412

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=production-dependencies --chown=node:node /build/node_modules ./node_modules
COPY --chown=node:node backend/package.json ./backend/package.json
COPY --chown=node:node backend/src ./backend/src
COPY --chown=node:node backend/migrations ./backend/migrations
COPY --chown=node:node backend/scripts/wait-for-postgres.js backend/scripts/migrate-postgres.js backend/scripts/reset-admin-password.js ./backend/scripts/
COPY --chown=node:node infra/backend-entrypoint.sh ./infra/

# Application code remains immutable. These links direct every file-backed
# runtime path to the volume mounted at /var/lib/campus-wall.
RUN mkdir -p /var/lib/campus-wall \
    && chown node:node /var/lib/campus-wall \
    && ln -s /var/lib/campus-wall/static /app/backend/static \
    && ln -s /var/lib/campus-wall/help /app/backend/help \
    && ln -s /var/lib/campus-wall/logs /app/backend/logs \
    && ln -s /var/lib/campus-wall/managers.json /app/backend/managers.json \
    && ln -s /var/lib/campus-wall/admin_log.json /app/backend/admin_log.json \
    && ln -s /var/lib/campus-wall/manage_message.json /app/backend/manage_message.json \
    && ln -s /var/lib/campus-wall/error.log /app/backend/error.log \
    && chmod 0555 /app/infra/backend-entrypoint.sh

USER node

EXPOSE 5412

ENTRYPOINT ["/usr/bin/tini", "--", "/app/infra/backend-entrypoint.sh"]
CMD ["sh", "-c", "node backend/scripts/wait-for-postgres.js && node backend/scripts/migrate-postgres.js && exec node backend/src/server.js"]
