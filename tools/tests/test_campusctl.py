from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).parents[1] / "campusctl.py"
SPEC = importlib.util.spec_from_file_location("campusctl", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
campusctl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(campusctl)


class CampusCtlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_install_creates_empty_state_and_removes_temps(self) -> None:
        cache = self.root / ".campus-cache"
        cache.mkdir()
        (cache / "leftover.tmp").write_bytes(b"partial")

        state = campusctl.install(self.root, 60)

        self.assertEqual({"version": 1, "artifacts": {}}, state)
        self.assertEqual(state, json.loads((cache / "state.json").read_text()))
        self.assertFalse((cache / "leftover.tmp").exists())

    def test_repeated_install_is_idempotent(self) -> None:
        campusctl.install(self.root, 60)
        state_path = self.root / ".campus-cache" / "state.json"
        first = state_path.read_bytes()

        campusctl.install(self.root, 60)

        self.assertEqual(first, state_path.read_bytes())
        self.assertEqual([], list((self.root / ".campus-cache").rglob("*.tmp")))

    def test_material_digest_is_independent_of_absolute_path(self) -> None:
        campusctl.install(self.root, 60)
        left = self.root / "left"
        right = self.root / "somewhere" / "right"
        for directory in (left, right):
            (directory / "nested").mkdir(parents=True)
            (directory / "nested" / "data.txt").write_bytes(b"same bytes")

        first = campusctl.build(self.root, [left], 60)
        second = campusctl.build(self.root, [right], 60)

        self.assertEqual(first["material"], second["material"])
        self.assertEqual(first["artifact"], second["artifact"])

    def test_artifact_digest_matches_output_bytes(self) -> None:
        campusctl.install(self.root, 60)
        source = self.root / "hello.txt"
        source.write_bytes(b"hello\x00world")

        result = campusctl.build(self.root, [source], 60)
        object_path = Path(result["object"])

        self.assertEqual(result["artifact"], hashlib.sha256(object_path.read_bytes()).hexdigest())
        self.assertNotEqual(result["material"], result["artifact"])

    def test_second_build_for_same_target_collects_replaced_object(self) -> None:
        campusctl.install(self.root, 60)
        source = self.root / "input.txt"
        source.write_text("first", encoding="utf-8")
        first = campusctl.build(self.root, [source], 60)
        first_object = Path(first["object"])
        source.write_text("second", encoding="utf-8")

        second = campusctl.build(self.root, [source], 60)

        self.assertFalse(first_object.exists())
        self.assertTrue(Path(second["object"]).exists())
        state = json.loads((self.root / ".campus-cache" / "state.json").read_text())
        self.assertEqual(
            {"material": second["material"], "artifact": second["artifact"]},
            state["artifacts"]["default"],
        )

    def test_different_targets_keep_their_current_objects(self) -> None:
        campusctl.install(self.root, 60)
        source = self.root / "input.txt"
        source.write_text("web", encoding="utf-8")
        web = campusctl.build(self.root, [source], 60, "web")
        source.write_text("api", encoding="utf-8")

        api = campusctl.build(self.root, [source], 60, "api")

        self.assertTrue(Path(web["object"]).exists())
        self.assertTrue(Path(api["object"]).exists())
        state = json.loads((self.root / ".campus-cache" / "state.json").read_text())
        self.assertEqual({"web", "api"}, set(state["artifacts"]))

    def test_root_directory_input_prunes_cache_dependencies_and_generated_caches(self) -> None:
        campusctl.install(self.root, 60)
        (self.root / "source.txt").write_text("source", encoding="utf-8")
        ignored_directories = [
            self.root / ".git",
            self.root / ".campus-cache" / "nested",
            self.root / "node_modules",
            self.root / "venv",
            self.root / ".venv",
            self.root / ".next",
            self.root / ".pytest_cache",
            self.root / "pkg" / "__pycache__",
        ]
        for directory in ignored_directories:
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "ignored.bin").write_bytes(b"first ignored value")

        first = campusctl.build(self.root, [self.root], 60)
        for directory in ignored_directories:
            marker = directory / "ignored.bin"
            if marker.exists():
                marker.write_bytes(b"changed ignored value")

        second = campusctl.build(self.root, [self.root], 60)

        self.assertEqual(first["material"], second["material"])
        self.assertEqual(first["artifact"], second["artifact"])

    def test_build_automatically_collects_garbage(self) -> None:
        campusctl.install(self.root, 60)
        cache = self.root / ".campus-cache"
        orphan = cache / "objects" / ("f" * 64)
        orphan.write_bytes(b"orphan")
        stale = cache / "abandoned" / "stale.part"
        stale.write_bytes(b"stale")
        stale.touch()
        temporary = cache / "objects" / "interrupted.tmp"
        temporary.write_bytes(b"partial")
        source = self.root / "input.txt"
        source.write_text("input", encoding="utf-8")

        campusctl.build(self.root, [source], 0)

        self.assertFalse(orphan.exists())
        self.assertFalse(stale.exists())
        self.assertFalse(temporary.exists())

    def test_clean_removes_only_generated_cache_directories(self) -> None:
        campusctl.install(self.root, 60)
        removable = [
            self.root / ".next",
            self.root / "pkg" / ".pytest_cache",
            self.root / "pkg" / "__pycache__",
        ]
        for directory in removable:
            directory.mkdir(parents=True)
            (directory / "cache.bin").write_bytes(b"cache")
        protected = [self.root / "node_modules", self.root / "venv", self.root / "business-data"]
        for directory in protected:
            directory.mkdir()
            (directory / ".next").mkdir()
            (directory / "keep.txt").write_text("keep", encoding="utf-8")
        source = self.root / "source.py"
        source.write_text("print('keep')", encoding="utf-8")

        campusctl.clean(self.root)

        self.assertFalse((self.root / ".campus-cache").exists())
        self.assertTrue(all(not directory.exists() for directory in removable))
        self.assertTrue(all((directory / "keep.txt").exists() for directory in protected))
        self.assertTrue((protected[0] / ".next").exists())
        self.assertTrue(source.exists())


if __name__ == "__main__":
    unittest.main()
