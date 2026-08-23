from campus_wall_api.cli import resolve_project_root


def test_resolve_project_root_uses_cwd_assets_without_editable_install(tmp_path, monkeypatch):
    asset_root = tmp_path / "app"
    asset_root.mkdir()
    (asset_root / "alembic.ini").write_text("[alembic]\n", encoding="utf-8")
    (asset_root / "migrations").mkdir()

    monkeypatch.chdir(asset_root)
    monkeypatch.delenv("CAMPUS_WALL_API_ROOT", raising=False)

    assert resolve_project_root() == asset_root.resolve()
