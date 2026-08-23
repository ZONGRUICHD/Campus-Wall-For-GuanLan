import argparse
import json
import os
import shutil
import sys
from collections.abc import Mapping
from pathlib import Path

from alembic import command
from alembic.config import Config

from campus_wall_api.access_control import (
    BootstrapConflictError,
    bootstrap_super_admin,
    seed_access_control,
)
from campus_wall_api.config import get_settings
from campus_wall_api.database import (
    create_database_engine,
    create_session_factory,
    normalize_database_url,
)
from campus_wall_api.seed import seed_database

SOURCE_PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIRECTORY_NAMES = {"__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache"}
CACHE_FILE_NAMES = {".coverage"}
CACHE_SKIP_DIRECTORY_NAMES = {".git", ".venv", "node_modules", "venv"}


class ProjectAssetsNotFoundError(RuntimeError):
    pass


def _has_project_assets(root: Path) -> bool:
    return (root / "alembic.ini").is_file() and (root / "migrations").is_dir()


def resolve_project_root(
    *,
    cwd: Path | None = None,
    environ: Mapping[str, str] | None = None,
    source_root: Path | None = None,
) -> Path:
    """Locate Alembic assets for source checkouts and non-editable installations."""

    current_directory = (cwd or Path.cwd()).resolve()
    environment = os.environ if environ is None else environ
    configured_root = environment.get("CAMPUS_WALL_API_ROOT", "").strip()

    if configured_root:
        configured_path = Path(configured_root).expanduser()
        if not configured_path.is_absolute():
            configured_path = current_directory / configured_path
        resolved_configured_path = configured_path.resolve()
        if _has_project_assets(resolved_configured_path):
            return resolved_configured_path
        raise ProjectAssetsNotFoundError(
            "CAMPUS_WALL_API_ROOT points to "
            f"'{resolved_configured_path}', but that directory does not contain both "
            "alembic.ini and migrations/. Set CAMPUS_WALL_API_ROOT to the API asset "
            "directory (for example /app)."
        )

    if _has_project_assets(current_directory):
        return current_directory

    resolved_source_root = (source_root or SOURCE_PROJECT_ROOT).resolve()
    if _has_project_assets(resolved_source_root):
        return resolved_source_root

    raise ProjectAssetsNotFoundError(
        "Could not locate Campus Wall API migration assets. Checked the current working "
        f"directory '{current_directory}' and source fallback '{resolved_source_root}'. "
        "Run the command from a directory containing alembic.ini and migrations/, or set "
        "CAMPUS_WALL_API_ROOT to that directory (for example /app)."
    )


def migrate_database(database_url: str) -> None:
    project_root = resolve_project_root()
    config = Config(str(project_root / "alembic.ini"))
    config.attributes["database_url"] = normalize_database_url(database_url)
    command.upgrade(config, "head")


def run_seed(database_url: str):
    engine = create_database_engine(database_url)
    try:
        return seed_database(create_session_factory(engine))
    finally:
        engine.dispose()


def run_access_control_seed(
    database_url: str,
    *,
    bootstrap_username: str,
    bootstrap_password: str | None,
):
    engine = create_database_engine(database_url)
    try:
        session_factory = create_session_factory(engine)
        seed_access_control(session_factory)
        if bootstrap_password is None:
            return None
        return bootstrap_super_admin(
            session_factory,
            username=bootstrap_username,
            password=bootstrap_password,
        )
    finally:
        engine.dispose()


def clean_caches(root: Path | None = None) -> int:
    """Remove generated Python/tool caches, constrained to this API project."""

    resolved_root = (root or resolve_project_root()).resolve()
    targets: list[Path] = []
    for current, directory_names, file_names in os.walk(resolved_root, topdown=True):
        current_path = Path(current)
        retained_directories: list[str] = []
        for name in directory_names:
            if name in CACHE_SKIP_DIRECTORY_NAMES:
                continue
            if name in CACHE_DIRECTORY_NAMES:
                targets.append(current_path / name)
                continue
            retained_directories.append(name)
        directory_names[:] = retained_directories
        targets.extend(current_path / name for name in file_names if name in CACHE_FILE_NAMES)

    removed = 0
    for path in sorted(targets, key=lambda item: len(item.parts), reverse=True):
        resolved_path = path.resolve()
        if not resolved_path.is_relative_to(resolved_root) or not resolved_path.exists():
            continue
        if resolved_path.is_dir():
            shutil.rmtree(resolved_path)
        else:
            resolved_path.unlink()
        removed += 1
    return removed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="campus-wall-api")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("install", help="idempotently migrate and seed")
    subparsers.add_parser("migrate", help="upgrade the database to the latest migration")
    subparsers.add_parser("seed", help="idempotently insert the demo dataset")
    subparsers.add_parser(
        "bootstrap-admin",
        help="idempotently create the initial super admin from environment secrets",
    )
    subparsers.add_parser("clean", help="remove API-local generated caches")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    settings = get_settings()
    database_url = settings.database_url

    try:
        if args.command == "clean":
            print(json.dumps({"removed": clean_caches()}))
            return

        if args.command == "migrate":
            migrate_database(database_url)
            print(json.dumps({"migration": "head"}))
            return

        if args.command == "seed":
            print(run_seed(database_url).model_dump_json())
            return

        if args.command == "bootstrap-admin":
            if settings.bootstrap_admin_password is None:
                print(
                    "campus-wall-api: error: BOOTSTRAP_ADMIN_PASSWORD is required",
                    file=sys.stderr,
                )
                raise SystemExit(2)
            result = run_access_control_seed(
                database_url,
                bootstrap_username=settings.bootstrap_admin_username,
                bootstrap_password=settings.bootstrap_admin_password.get_secret_value(),
            )
            print(result.model_dump_json())
            return

        migrate_database(database_url)
        result = run_seed(database_url)
        bootstrap_result = run_access_control_seed(
            database_url,
            bootstrap_username=settings.bootstrap_admin_username,
            bootstrap_password=(
                settings.bootstrap_admin_password.get_secret_value()
                if settings.bootstrap_admin_password is not None
                else None
            ),
        )
        output = {
            "migration": "head",
            "access_control": "ready",
            **result.model_dump(),
        }
        if bootstrap_result is not None:
            output["admin"] = bootstrap_result.model_dump()
        print(json.dumps(output, ensure_ascii=False))
    except (BootstrapConflictError, ProjectAssetsNotFoundError, ValueError) as exc:
        print(f"campus-wall-api: error: {exc}", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
