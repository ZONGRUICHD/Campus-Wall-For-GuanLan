import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any
from uuid import uuid4

import jwt
from pwdlib import PasswordHash

from campus_wall_api.config import Settings

PASSWORD_HASH = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = PASSWORD_HASH.hash("not-a-real-user-password")


class InvalidAccessTokenError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class AccessTokenClaims:
    user_id: str
    session_id: str


def normalize_username(username: str) -> str:
    return username.strip().casefold()


def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise ValueError("password must contain at least 8 characters")
    if len(password) > 128:
        raise ValueError("password must contain at most 128 characters")
    if not any(character.isalpha() for character in password):
        raise ValueError("password must contain at least one letter")
    if not any(character.isdigit() for character in password):
        raise ValueError("password must contain at least one number")


def hash_password(password: str) -> str:
    validate_password_strength(password)
    return PASSWORD_HASH.hash(password)


def verify_password(password: str, password_hash: str) -> tuple[bool, str | None]:
    return PASSWORD_HASH.verify_and_update(password, password_hash)


def consume_dummy_password_check(password: str) -> None:
    """Keep unknown-user login work comparable to a real password check."""

    PASSWORD_HASH.verify(password, DUMMY_PASSWORD_HASH)


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def hash_private_value(value: str, settings: Settings) -> str:
    normalized = value.strip().casefold().encode("utf-8")
    return hmac.new(
        settings.pii_hash_secret.get_secret_value().encode("utf-8"),
        normalized,
        sha256,
    ).hexdigest()


def create_access_token(
    *,
    user_id: str,
    session_id: str,
    settings: Settings,
    now: datetime | None = None,
) -> tuple[str, int]:
    issued_at = now or datetime.now(UTC)
    expires_at = issued_at + timedelta(minutes=settings.access_token_minutes)
    payload: dict[str, Any] = {
        "sub": user_id,
        "sid": session_id,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": issued_at,
        "nbf": issued_at,
        "exp": expires_at,
        "jti": str(uuid4()),
    }
    token = jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    return token, int((expires_at - issued_at).total_seconds())


def decode_access_token(token: str, settings: Settings) -> AccessTokenClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "sid", "iss", "aud", "iat", "exp", "jti"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidAccessTokenError("invalid or expired access token") from exc

    user_id = payload.get("sub")
    session_id = payload.get("sid")
    if not isinstance(user_id, str) or not isinstance(session_id, str):
        raise InvalidAccessTokenError("invalid access token claims")
    return AccessTokenClaims(user_id=user_id, session_id=session_id)
