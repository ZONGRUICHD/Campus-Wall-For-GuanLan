# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS builder

WORKDIR /build

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --workspace=frontend --include-workspace-root=false

COPY frontend/index.html frontend/vite.config.js ./frontend/
COPY frontend/public ./frontend/public
COPY frontend/src ./frontend/src

ARG VITE_APP_ENV=production
ENV VITE_APP_ENV=${VITE_APP_ENV}

RUN npm --workspace=frontend run build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/proxy_params /etc/nginx/proxy_params
COPY --from=builder /build/frontend/dist /usr/share/nginx/html

EXPOSE 8080
