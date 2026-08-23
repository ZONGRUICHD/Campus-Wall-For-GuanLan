from campus_wall_api.cli import clean_caches, resolve_project_root


def test_resolve_project_root_uses_cwd_assets_without_editable_install(tmp_path, monkeypatch):
    asset_root = tmp_path / "app"
    asset_root.mkdir()
    (asset_root / "alembic.ini").write_text("[alembic]\n", encoding="utf-8")
    (asset_root / "migrations").mkdir()

    monkeypatch.chdir(asset_root)
    monkeypatch.delenv("CAMPUS_WALL_API_ROOT", raising=False)

    assert resolve_project_root() == asset_root.resolve()


def test_clean_caches_keeps_installed_dependencies(tmp_path):
    project_cache = tmp_path / "src" / "__pycache__"
    tool_cache = tmp_path / ".pytest_cache"
    dependency_cache = tmp_path / ".venv" / "Lib" / "site-packages" / "demo" / "__pycache__"
    for directory in (project_cache, tool_cache, dependency_cache):
        directory.mkdir(parents=True)
        (directory / "cache.bin").write_bytes(b"cache")

    removed = clean_caches(tmp_path)

    assert removed == 2
    assert not project_cache.exists()
    assert not tool_cache.exists()
    assert dependency_cache.exists()
