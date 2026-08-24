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

ARG VITE_API_BASE_URL=
ARG VITE_STATIC_URL=
ARG VITE_UMAMI_WEBSITE_ID=dd522469-2b45-4814-812e-202678ccee7a
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_STATIC_URL=${VITE_STATIC_URL} \
    VITE_UMAMI_WEBSITE_ID=${VITE_UMAMI_WEBSITE_ID}

RUN npm --workspace=frontend run build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/proxy_params /etc/nginx/proxy_params
COPY --from=builder /build/frontend/dist /usr/share/nginx/html

EXPOSE 8080
