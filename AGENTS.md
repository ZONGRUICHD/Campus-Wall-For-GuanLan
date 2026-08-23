# 观澜校园墙 (GuanLan Campus Wall)

Monorepo for a campus wall MVP web app. See `README.md` for the product overview and the canonical local dev / verification commands, `apps/api/README.md` for API details, and `infra/README.md` for containers.

- `apps/web/` — Next.js 16 + React 19 frontend (port 3000). Package manager: npm.
- `apps/api/` — FastAPI + SQLAlchemy 2 + Alembic backend (port 8000). Package manager: uv, Python 3.14.
- `tools/campusctl.py` — repo-level idempotent install/build/clean cache lifecycle (stdlib only).
- `infra/` — Dockerfiles + Compose.

## Cursor Cloud specific instructions

The update script installs `uv` (to `~/.local/bin`, which is also added to `~/.bashrc`), runs `uv sync --project apps/api --extra test` (uv auto-provisions Python 3.14), and runs `npm ci --prefix apps/web`. It intentionally does NOT run the DB bootstrap; do that once per session before starting the API (see below).

- Toolchain caveat: the API requires Python 3.14 but the base image only ships Python 3.12. `uv` provisions 3.14 automatically, so always run API commands through `uv run --project apps/api ...` rather than the system `python3`. `uv` is not on `PATH` in a fresh non-login shell until `~/.bashrc` is sourced; prefix with `export PATH="$HOME/.local/bin:$PATH"` if it is missing.
- DB bootstrap (run once before starting the API): `uv run --project apps/api campus-wall-api install`. This runs Alembic migrations to head and idempotently seeds 6 demo posts; safe to re-run.
- Start the API (dev, hot reload): `uv run --project apps/api uvicorn campus_wall_api.main:app --app-dir apps/api/src --reload --port 8000`. Health check: `GET http://localhost:8000/health`. Interactive docs at `/docs`.
- Start the web (dev, hot reload): `npm run dev --prefix apps/web` (serves http://localhost:3000, expects the API at `NEXT_PUBLIC_API_URL`, default `http://localhost:8000`).
- Run both dev servers in long-lived tmux sessions (they are foreground processes). Do not put them in the update script.
- Default DB is SQLite at `apps/api/campus_wall.db`, created/migrated/seeded by `campus-wall-api install` (idempotent: safe to re-run). Schema is managed only by Alembic — the app never calls `create_all`. Set `DATABASE_URL` to a `postgresql://...` URL to use PostgreSQL instead.
- If the web shows a "演示数据" (demo data) fallback banner, the API is unreachable — start/verify the API on port 8000. When the API is up, posts persist for real (verify with `curl http://localhost:8000/api/v1/posts`).
- There is no auth in the MVP; likes/reactions use a fixed demo actor. No secrets are required.
- `apps/web/AGENTS.md` is auto-generated/re-added by `next dev`; committing it keeps the tree clean.
- Verification commands (from `README.md`): `npm run lint --prefix apps/web`, `uv run --project apps/api --extra test pytest -q`, and `python3 -m unittest discover -s tools/tests -v`.
