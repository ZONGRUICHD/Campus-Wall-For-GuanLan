from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_JWT_SECRET = "development-only-secret-do-not-use-in-production"
DEVELOPMENT_PII_HASH_SECRET = "development-only-pii-secret-not-for-production"
DEVELOPMENT_CRON_SECRET = "development-only-cron-secret-not-for-production"


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables."""

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite+pysqlite:///./campus_wall.db"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    jwt_secret: SecretStr = SecretStr(DEVELOPMENT_JWT_SECRET)
    pii_hash_secret: SecretStr = SecretStr(DEVELOPMENT_PII_HASH_SECRET)
    cron_secret: SecretStr = SecretStr(DEVELOPMENT_CRON_SECRET)
    jwt_issuer: str = "guanlan-campus-wall-api"
    jwt_audience: str = "guanlan-campus-wall-web"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    login_max_attempts: int = 5
    login_lock_minutes: int = 15
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: SecretStr | None = None
    media_uploads_enabled: bool = False
    media_upload_max_bytes: int = 8 * 1024 * 1024
    media_max_per_post: int = 6
    media_upload_ttl_seconds: int = 15 * 60
    media_uploads_per_minute: int = 20
    object_storage_endpoint: str | None = None
    object_storage_region: str = "auto"
    object_storage_bucket: str | None = None
    object_storage_access_key_id: str | None = None
    object_storage_secret_access_key: SecretStr | None = None
    object_storage_public_base_url: str | None = None
    object_storage_force_path_style: bool = False

    model_config = SettingsConfigDict(
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def media_uploads_active(self) -> bool:
        return self.app_env in {"development", "test"} or self.media_uploads_enabled

    @model_validator(mode="after")
    def validate_production_security(self) -> Settings:
        if self.access_token_minutes < 1 or self.refresh_token_days < 1:
            raise ValueError("token lifetimes must be positive")
        if self.login_max_attempts < 1 or self.login_lock_minutes < 1:
            raise ValueError("login lock settings must be positive")
        if not 1 <= self.media_max_per_post <= 9:
            raise ValueError("MEDIA_MAX_PER_POST must be between 1 and 9")
        if not 1_024 <= self.media_upload_max_bytes <= 20 * 1024 * 1024:
            raise ValueError("MEDIA_UPLOAD_MAX_BYTES must be between 1 KiB and 20 MiB")
        if not 60 <= self.media_upload_ttl_seconds <= 3_600:
            raise ValueError("MEDIA_UPLOAD_TTL_SECONDS must be between 60 and 3600")
        if not 1 <= self.media_uploads_per_minute <= 100:
            raise ValueError("MEDIA_UPLOADS_PER_MINUTE must be between 1 and 100")

        if self.app_env == "production":
            jwt_secret = self.jwt_secret.get_secret_value()
            pii_hash_secret = self.pii_hash_secret.get_secret_value()
            cron_secret = self.cron_secret.get_secret_value()
            if jwt_secret == DEVELOPMENT_JWT_SECRET or len(jwt_secret) < 32:
                raise ValueError(
                    "production JWT_SECRET must be a unique value of at least 32 characters"
                )
            if (
                pii_hash_secret == DEVELOPMENT_PII_HASH_SECRET
                or len(pii_hash_secret) < 32
                or pii_hash_secret == jwt_secret
            ):
                raise ValueError(
                    "production PII_HASH_SECRET must be a separate value of at least 32 characters"
                )
            if cron_secret == DEVELOPMENT_CRON_SECRET or len(cron_secret) < 32:
                raise ValueError(
                    "production CRON_SECRET must be a unique value of at least 32 characters"
                )
            if "*" in self.cors_origin_list:
                raise ValueError("production CORS_ORIGINS cannot contain a wildcard")
            if any(not origin.startswith("https://") for origin in self.cors_origin_list):
                raise ValueError("production CORS_ORIGINS must contain only HTTPS origins")
            if self.media_uploads_enabled:
                storage_values = {
                    "OBJECT_STORAGE_BUCKET": self.object_storage_bucket,
                    "OBJECT_STORAGE_ACCESS_KEY_ID": self.object_storage_access_key_id,
                    "OBJECT_STORAGE_SECRET_ACCESS_KEY": (
                        self.object_storage_secret_access_key.get_secret_value()
                        if self.object_storage_secret_access_key
                        else None
                    ),
                    "OBJECT_STORAGE_PUBLIC_BASE_URL": self.object_storage_public_base_url,
                }
                missing = [name for name, value in storage_values.items() if not value]
                if missing:
                    raise ValueError(
                        "media uploads require object storage settings: "
                        + ", ".join(sorted(missing))
                    )
                if not self.object_storage_public_base_url.startswith("https://"):
                    raise ValueError(
                        "production OBJECT_STORAGE_PUBLIC_BASE_URL must use HTTPS"
                    )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
