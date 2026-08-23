from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import seed_access_control
from campus_wall_api.cli import migrate_database
from campus_wall_api.database import create_database_engine, create_session_factory
from campus_wall_api.main import create_app


@dataclass(slots=True)
class ApiHarness:
    client: TestClient
    session_factory: sessionmaker[Session]
    engine: Engine
    database_url: str


@pytest.fixture
def api(tmp_path):
    database_path = tmp_path / "campus_wall_test.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    migrate_database(database_url)

    engine = create_database_engine(database_url)
    session_factory = create_session_factory(engine)
    seed_access_control(session_factory)
    app = create_app(session_factory)

    with TestClient(app) as client:
        yield ApiHarness(
            client=client,
            session_factory=session_factory,
            engine=engine,
            database_url=database_url,
        )

    engine.dispose()

