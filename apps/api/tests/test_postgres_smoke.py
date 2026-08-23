import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from campus_wall_api.access_control import seed_access_control
from campus_wall_api.cli import migrate_database
from campus_wall_api.config import Settings
from campus_wall_api.database import create_database_engine, create_session_factory
from campus_wall_api.main import create_app

POSTGRES_TEST_DATABASE_URL = os.getenv("POSTGRES_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not POSTGRES_TEST_DATABASE_URL,
    reason="POSTGRES_TEST_DATABASE_URL is not configured",
)


def test_postgresql_migration_identity_and_content_round_trip():
    assert POSTGRES_TEST_DATABASE_URL is not None
    migrate_database(POSTGRES_TEST_DATABASE_URL)
    engine = create_database_engine(POSTGRES_TEST_DATABASE_URL)
    session_factory = create_session_factory(engine)
    seed_access_control(session_factory)
    settings = Settings(
        app_env="test",
        database_url=POSTGRES_TEST_DATABASE_URL,
        jwt_secret="postgres-smoke-test-secret-with-32-characters",
    )
    username = f"pg_{uuid4().hex[:12]}"
    post_title = f"PostgreSQL 全链路 {username}"

    try:
        with TestClient(create_app(session_factory, settings)) as client:
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "username": username,
                    "password": "Postgres2026",
                    "display_name": "PostgreSQL 测试员",
                },
            )
            assert registered.status_code == 201, registered.text

            login = client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "Postgres2026"},
            )
            assert login.status_code == 200, login.text
            headers = {
                "Authorization": f"Bearer {login.json()['access_token']}",
            }

            created = client.post(
                "/api/v1/posts",
                headers=headers,
                json={
                    "title": post_title,
                    "body": "迁移、身份、写入和读取均通过。",
                    "board": "daily",
                },
            )
            assert created.status_code == 201, created.text

            listed = client.get(
                "/api/v1/posts",
                headers=headers,
                params={"query": post_title},
            )
            assert listed.status_code == 200, listed.text
            assert [item["id"] for item in listed.json()["items"]] == [created.json()["id"]]

            lost_found = client.post(
                "/api/v1/posts",
                headers=headers,
                json={
                    "title": f"PostgreSQL 失物认领 {username}",
                    "body": "验证结构化失物字段和私密认领状态机。",
                    "board": "lost_found",
                    "kind": "lost",
                    "item_category": "electronics",
                    "location": "PostgreSQL 测试教室",
                    "occurred_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
                },
            )
            assert lost_found.status_code == 201, lost_found.text

            claimant_username = f"{username}_claim"
            claimant_registered = client.post(
                "/api/v1/auth/register",
                json={
                    "username": claimant_username,
                    "password": "Postgres2026",
                    "display_name": "PostgreSQL 认领测试员",
                },
            )
            assert claimant_registered.status_code == 201, claimant_registered.text
            claimant_login = client.post(
                "/api/v1/auth/login",
                json={
                    "username": claimant_username,
                    "password": "Postgres2026",
                },
            )
            assert claimant_login.status_code == 200, claimant_login.text
            claimant_headers = {
                "Authorization": f"Bearer {claimant_login.json()['access_token']}",
            }
            claim = client.post(
                f"/api/v1/lost-found/{lost_found.json()['id']}/claims",
                headers=claimant_headers,
                json={
                    "message": "我可以说明设备保护壳内侧的标记和遗失经过。",
                    "anonymous": True,
                },
            )
            assert claim.status_code == 201, claim.text

            accepted = client.patch(
                f"/api/v1/lost-found/{lost_found.json()['id']}/claims/{claim.json()['id']}",
                headers=headers,
                json={"status": "accepted"},
            )
            assert accepted.status_code == 200, accepted.text
            assert accepted.json()["status"] == "accepted"

            resolved = client.get(
                "/api/v1/posts",
                headers=headers,
                params={"query": f"PostgreSQL 失物认领 {username}"},
            )
            assert resolved.status_code == 200, resolved.text
            assert resolved.json()["items"][0]["resolved"] is True
    finally:
        engine.dispose()
