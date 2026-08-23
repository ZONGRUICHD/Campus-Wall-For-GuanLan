import os
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
                    "title": "PostgreSQL 全链路",
                    "body": "迁移、身份、写入和读取均通过。",
                    "board": "daily",
                },
            )
            assert created.status_code == 201, created.text

            listed = client.get(
                "/api/v1/posts",
                headers=headers,
                params={"query": "PostgreSQL 全链路"},
            )
            assert listed.status_code == 200, listed.text
            assert [item["id"] for item in listed.json()["items"]] == [created.json()["id"]]
    finally:
        engine.dispose()
