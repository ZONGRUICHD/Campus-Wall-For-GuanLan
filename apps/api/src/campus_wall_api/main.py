from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.api import create_api_router
from campus_wall_api.auth import IdentityProvider, create_auth_router
from campus_wall_api.config import Settings, get_settings
from campus_wall_api.database import SessionFactory
from campus_wall_api.governance_api import create_governance_router
from campus_wall_api.user_api import create_user_router


def create_app(
    session_factory: sessionmaker[Session] | None = None,
    settings: Settings | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    resolved_session_factory = session_factory or SessionFactory
    identity_provider = IdentityProvider(
        resolved_session_factory,
        resolved_settings,
    )
    app = FastAPI(
        title="GuanLan Campus Wall API",
        version="0.2.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(
        create_auth_router(
            resolved_session_factory,
            resolved_settings,
            identity_provider,
        )
    )
    app.include_router(
        create_api_router(
            resolved_session_factory,
            identity_provider,
            resolved_settings,
        )
    )
    app.include_router(
        create_user_router(
            resolved_session_factory,
            resolved_settings,
            identity_provider,
        )
    )
    app.include_router(
        create_governance_router(
            resolved_session_factory,
            identity_provider,
        )
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
