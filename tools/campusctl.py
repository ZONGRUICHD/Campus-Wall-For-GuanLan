#!/usr/bin/env python3
"""Small, deterministic cache manager for Campus Wall builds."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import time
from typing import Iterable


CACHE_NAME = ".campus-cache"
STATE_NAME = "state.json"
STATE_VERSION = 1
DEFAULT_ABANDONED_TTL = 24 * 60 * 60
SKIP_TREES = {".git", "node_modules", "venv", ".venv", "env", ".env"}
BUILD_SKIP_TREES = {".git", CACHE_NAME, "node_modules", "venv", ".venv"}
CACHE_DIR_NAMES = {
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".tox",
    ".nox",
    "__pycache__",
}


class CampusError(Exception):
    """A user-facing command error."""


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _empty_state() -> dict[str, object]:
    return {"version": STATE_VERSION, "artifacts": {}}


def _atomic_write(path: Path, data: bytes) -> None:
    """Durably replace path using exactly one same-directory temporary inode."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
        _fsync_directory(path.parent)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _fsync_directory(directory: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _load_state(cache: Path, *, required: bool = True) -> dict[str, object]:
    path = cache / STATE_NAME
    if not path.exists():
        if required:
            raise CampusError("not installed; run 'campusctl.py install' first")
        return _empty_state()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise CampusError(f"cannot read {path}: {error}") from error
    if not isinstance(state, dict) or state.get("version") != STATE_VERSION:
        raise CampusError(f"unsupported or invalid state in {path}")
    artifacts = state.get("artifacts")
    if not isinstance(artifacts, dict):
        raise CampusError(f"invalid artifacts manifest in {path}")
    return state


def _remove_stale_temps(cache: Path) -> None:
    if not cache.exists():
        return
    for path in cache.rglob("*.tmp"):
        if path.is_file() or path.is_symlink():
            path.unlink(missing_ok=True)


def _referenced_digests(state: dict[str, object]) -> set[str]:
    artifacts = state["artifacts"]
    assert isinstance(artifacts, dict)
    return {
        record["artifact"]
        for record in artifacts.values()
        if isinstance(record, dict) and isinstance(record.get("artifact"), str)
    }


def _garbage_collect(cache: Path, state: dict[str, object], ttl: float) -> None:
    _remove_stale_temps(cache)
    now = time.time()
    referenced = _referenced_digests(state)
    objects = cache / "objects"
    if objects.exists():
        for path in objects.iterdir():
            if path.is_file() and path.name not in referenced:
                path.unlink(missing_ok=True)
    abandoned = cache / "abandoned"
    if abandoned.exists():
        for path in sorted(abandoned.rglob("*"), reverse=True):
            if path.is_file() and now - path.stat().st_mtime > ttl:
                path.unlink(missing_ok=True)
            elif path.is_dir():
                try:
                    path.rmdir()
                except OSError:
                    pass


def install(root: Path, ttl: float) -> dict[str, object]:
    cache = root / CACHE_NAME
    cache.mkdir(parents=True, exist_ok=True)
    _remove_stale_temps(cache)
    state = _load_state(cache, required=False)
    (cache / "objects").mkdir(exist_ok=True)
    (cache / "abandoned").mkdir(exist_ok=True)
    _garbage_collect(cache, state, ttl)
    _atomic_write(cache / STATE_NAME, _json_bytes(state))
    return state


def _logical_files(inputs: Iterable[Path]) -> list[tuple[str, bytes]]:
    files: dict[str, bytes] = {}
    for supplied in inputs:
        path = supplied.resolve()
        if path.is_file():
            candidates = [(path.name, path)]
        elif path.is_dir():
            candidates = []
            for current, directory_names, file_names in os.walk(path, topdown=True):
                directory_names[:] = sorted(
                    name
                    for name in directory_names
                    if name not in BUILD_SKIP_TREES and name not in CACHE_DIR_NAMES
                )
                current_path = Path(current)
                candidates.extend(
                    (source.relative_to(path).as_posix(), source)
                    for source in (current_path / name for name in sorted(file_names))
                    if source.is_file()
                )
        else:
            raise CampusError(f"input does not exist or is not a regular file/directory: {supplied}")
        for logical_name, source in candidates:
            normalized = logical_name.replace("\\", "/").lstrip("/")
            if not normalized or normalized in files:
                raise CampusError(f"duplicate or invalid logical input name: {normalized!r}")
            files[normalized] = source.read_bytes()
    if not files:
        raise CampusError("inputs contain no files")
    return sorted(files.items())


def _framed_files(files: list[tuple[str, bytes]]) -> bytes:
    chunks = [b"CAMPUS-ARTIFACT\0", struct.pack(">Q", len(files))]
    for name, content in files:
        encoded_name = name.encode("utf-8")
        chunks.extend((struct.pack(">Q", len(encoded_name)), encoded_name, struct.pack(">Q", len(content)), content))
    return b"".join(chunks)


def _material_digest(files: list[tuple[str, bytes]]) -> str:
    digest = hashlib.sha256(b"CAMPUS-MATERIAL\0")
    for name, content in files:
        encoded_name = name.encode("utf-8")
        digest.update(struct.pack(">Q", len(encoded_name)))
        digest.update(encoded_name)
        digest.update(struct.pack(">Q", len(content)))
        digest.update(content)
    return digest.hexdigest()


def build(root: Path, inputs: Iterable[Path], ttl: float, target: str = "default") -> dict[str, str]:
    if not target or "\x00" in target:
        raise CampusError("target must be a non-empty name without NUL characters")
    cache = root / CACHE_NAME
    state = _load_state(cache)
    _garbage_collect(cache, state, ttl)
    files = _logical_files(inputs)
    material = _material_digest(files)
    output = _framed_files(files)
    artifact = hashlib.sha256(output).hexdigest()
    object_path = cache / "objects" / artifact
    if not object_path.exists():
        _atomic_write(object_path, output)
    artifacts = state["artifacts"]
    assert isinstance(artifacts, dict)
    artifacts[target] = {"material": material, "artifact": artifact}
    _atomic_write(cache / STATE_NAME, _json_bytes(state))
    _garbage_collect(cache, state, ttl)
    return {"target": target, "material": material, "artifact": artifact, "object": str(object_path)}


def clean(root: Path) -> int:
    removed = 0
    cache = root / CACHE_NAME
    if cache.exists():
        shutil.rmtree(cache)
        removed += 1
    for current, directory_names, _ in os.walk(root, topdown=True):
        directory_names[:] = [name for name in directory_names if name not in SKIP_TREES and name != CACHE_NAME]
        current_path = Path(current)
        for name in list(directory_names):
            if name in CACHE_DIR_NAMES:
                shutil.rmtree(current_path / name)
                directory_names.remove(name)
                removed += 1
    return removed


def _ttl(value: str) -> float:
    try:
        result = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("TTL must be a number of seconds") from error
    if result < 0:
        raise argparse.ArgumentTypeError("TTL cannot be negative")
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="campusctl")
    parser.add_argument("--root", type=Path, default=Path.cwd(), help=argparse.SUPPRESS)
    parser.add_argument(
        "--ttl",
        type=_ttl,
        default=_ttl(os.environ.get("CAMPUSCTL_ABANDONED_TTL_SECONDS", str(DEFAULT_ABANDONED_TTL))),
        help="seconds before abandoned files are collected",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("install", help="initialize or repair the local cache")
    build_parser = commands.add_parser("build", help="build deterministic content-addressed output")
    build_parser.add_argument("--target", default="default", help="stable manifest target name")
    build_parser.add_argument("inputs", nargs="+", type=Path)
    commands.add_parser("clean", help="remove generated caches")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    root = args.root.resolve()
    try:
        if args.command == "install":
            state = install(root, args.ttl)
            print(json.dumps({"status": "installed", "artifacts": len(state["artifacts"])}))
        elif args.command == "build":
            print(json.dumps(build(root, args.inputs, args.ttl, args.target), sort_keys=True))
        else:
            print(json.dumps({"status": "clean", "removed": clean(root)}))
        return 0
    except KeyboardInterrupt:
        _remove_stale_temps(root / CACHE_NAME)
        return 130
    except (CampusError, OSError) as error:
        print(f"campusctl: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
