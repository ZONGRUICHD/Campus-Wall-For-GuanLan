from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import seed_access_control
from campus_wall_api.cli import migrate_database
from campus_wall_api.database import create_database_engine, create_session_factory
from campus_wall_api.main import create_app
from campus_wall_api.media_storage import DevelopmentMediaStorage


@dataclass(slots=True)
class ApiHarness:
    client: TestClient
    session_factory: sessionmaker[Session]
    engine: Engine
    database_url: str
    auth_headers: dict[str, str]
    media_storage: DevelopmentMediaStorage


@pytest.fixture
def api(tmp_path):
    database_path = tmp_path / "campus_wall_test.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    migrate_database(database_url)

    engine = create_database_engine(database_url)
    session_factory = create_session_factory(engine)
    seed_access_control(session_factory)
    media_storage = DevelopmentMediaStorage(
        max_bytes=8 * 1024 * 1024,
        max_pixels=24_000_000,
    )
    app = create_app(session_factory, media_storage=media_storage)

    with TestClient(app) as client:
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "username": "api_tester",
                "password": "ApiTester2026",
                "display_name": "接口测试同学",
            },
        )
        assert registered.status_code == 201, registered.text
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "api_tester", "password": "ApiTester2026"},
        )
        assert login.status_code == 200, login.text
        yield ApiHarness(
            client=client,
            session_factory=session_factory,
            engine=engine,
            database_url=database_url,
            auth_headers={
                "Authorization": f"Bearer {login.json()['access_token']}",
            },
            media_storage=media_storage,
        )

    engine.dispose()
