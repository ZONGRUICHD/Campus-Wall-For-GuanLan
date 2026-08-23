from collections.abc import Iterator
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.config import get_settings


def normalize_database_url(database_url: str) -> str:
    """Select psycopg 3 when DATABASE_URL uses a generic PostgreSQL scheme."""

    if database_url.startswith("postgres://"):
        return "postgresql+psycopg://" + database_url.removeprefix("postgres://")
    if database_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + database_url.removeprefix("postgresql://")
    return database_url


def create_database_engine(database_url: str) -> Engine:
    normalized_url = normalize_database_url(database_url)
    url = make_url(normalized_url)
    engine_kwargs: dict[str, Any] = {}

    if url.get_backend_name() == "sqlite":
        engine_kwargs["connect_args"] = {"check_same_thread": False}

    engine = create_engine(normalized_url, **engine_kwargs)

    if url.get_backend_name() == "sqlite":

        @event.listens_for(engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection: Any, _: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(
        bind=engine,
        class_=Session,
        expire_on_commit=False,
        autobegin=False,
    )


engine = create_database_engine(get_settings().database_url)
SessionFactory = create_session_factory(engine)


def session_dependency(
    session_factory: sessionmaker[Session],
) -> Iterator[Session]:
    """Yield one request-scoped session and discard any unfinished transaction."""

    with session_factory() as session:
        try:
            yield session
        finally:
            if session.in_transaction():
                session.rollback()
