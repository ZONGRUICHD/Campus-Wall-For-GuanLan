from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_JWT_SECRET = "development-only-secret-do-not-use-in-production"


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables."""

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite+pysqlite:///./campus_wall.db"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    jwt_secret: SecretStr = SecretStr(DEVELOPMENT_JWT_SECRET)
    jwt_issuer: str = "guanlan-campus-wall-api"
    jwt_audience: str = "guanlan-campus-wall-web"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    login_max_attempts: int = 5
    login_lock_minutes: int = 15
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: SecretStr | None = None

    model_config = SettingsConfigDict(
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def validate_production_security(self) -> Settings:
        if self.access_token_minutes < 1 or self.refresh_token_days < 1:
            raise ValueError("token lifetimes must be positive")
        if self.login_max_attempts < 1 or self.login_lock_minutes < 1:
            raise ValueError("login lock settings must be positive")

        if self.app_env == "production":
            jwt_secret = self.jwt_secret.get_secret_value()
            if jwt_secret == DEVELOPMENT_JWT_SECRET or len(jwt_secret) < 32:
                raise ValueError(
                    "production JWT_SECRET must be a unique value of at least 32 characters"
                )
            if "*" in self.cors_origin_list:
                raise ValueError("production CORS_ORIGINS cannot contain a wildcard")
            if any(not origin.startswith("https://") for origin in self.cors_origin_list):
                raise ValueError("production CORS_ORIGINS must contain only HTTPS origins")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
