from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import (
    ASSIGNABLE_ADMIN_ROLES,
    audit_event,
    get_user_permissions,
    get_user_roles,
)
from campus_wall_api.auth_schemas import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    RoleChangeRead,
    TokenPair,
    UserList,
    UserRead,
)
from campus_wall_api.config import Settings
from campus_wall_api.database import session_dependency
from campus_wall_api.models import AuthSession, User, UserRole, utc_now
from campus_wall_api.security import (
    InvalidAccessTokenError,
    consume_dummy_password_check,
    create_access_token,
    decode_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    normalize_username,
    validate_password_strength,
    verify_password,
)

bearer_scheme = HTTPBearer(auto_error=False)
CredentialsDependency = Annotated[
    HTTPAuthorizationCredentials | None,
    Depends(bearer_scheme),
]


@dataclass(frozen=True, slots=True)
class CurrentIdentity:
    user: User
    session_id: str
    roles: frozenset[str]
    permissions: frozenset[str]


def _auth_error(
    detail: str = "invalid or expired credentials",
    *,
    status_code: int = status.HTTP_401_UNAUTHORIZED,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": "authentication_failed", "message": detail},
        headers={"WWW-Authenticate": "Bearer"},
    )


class IdentityProvider:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        settings: Settings,
    ) -> None:
        self.session_factory = session_factory
        self.settings = settings

    def __call__(self, credentials: CredentialsDependency) -> CurrentIdentity:
        if credentials is None or credentials.scheme.casefold() != "bearer":
            raise _auth_error()
        try:
            claims = decode_access_token(credentials.credentials, self.settings)
        except InvalidAccessTokenError as exc:
            raise _auth_error() from exc

        now = datetime.now(UTC)
        with self.session_factory() as session, session.begin():
            auth_session = session.get(AuthSession, claims.session_id)
            user = session.get(User, claims.user_id)
            if (
                auth_session is None
                or auth_session.user_id != claims.user_id
                or auth_session.revoked_at is not None
                or auth_session.expires_at <= now
                or user is None
                or user.status != "active"
            ):
                raise _auth_error()
            roles = frozenset(get_user_roles(session, user.id))
            permissions = frozenset(get_user_permissions(session, user.id))

        return CurrentIdentity(
            user=user,
            session_id=claims.session_id,
            roles=roles,
            permissions=permissions,
        )


def _user_read(session: Session, user: User) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        status=user.status,
        campus_verified=user.campus_verified,
        must_change_password=user.must_change_password,
        roles=get_user_roles(session, user.id),
        permissions=get_user_permissions(session, user.id),
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


def _issue_token_pair(
    session: Session,
    *,
    user: User,
    settings: Settings,
    now: datetime,
) -> TokenPair:
    refresh_token = new_refresh_token()
    auth_session = AuthSession(
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(refresh_token),
        expires_at=now + timedelta(days=settings.refresh_token_days),
    )
    session.add(auth_session)
    session.flush()
    access_token, expires_in = create_access_token(
        user_id=user.id,
        session_id=auth_session.id,
        settings=settings,
        now=now,
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
        user=_user_read(session, user),
    )


def create_auth_router(
    session_factory: sessionmaker[Session],
    settings: Settings,
    identity_provider: IdentityProvider | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    resolved_identity_provider = identity_provider or IdentityProvider(
        session_factory,
        settings,
    )

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]

    CurrentIdentityDependency = Annotated[
        CurrentIdentity,
        Depends(resolved_identity_provider),
    ]

    @router.post(
        "/auth/register",
        response_model=UserRead,
        status_code=status.HTTP_201_CREATED,
    )
    def register(payload: RegisterRequest, session: SessionDependency) -> UserRead:
        try:
            password_hash = hash_password(payload.password)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={"code": "weak_password", "message": str(exc)},
            ) from exc

        normalized_username = normalize_username(payload.username)
        try:
            with session.begin():
                user = User(
                    username=payload.username,
                    normalized_username=normalized_username,
                    email=payload.email,
                    display_name=payload.display_name,
                    password_hash=password_hash,
                )
                session.add(user)
                session.flush()
                session.add(UserRole(user_id=user.id, role_name="student"))
                audit_event(
                    session,
                    action="identity.register",
                    target_type="user",
                    target_id=user.id,
                )
                session.flush()
                result = _user_read(session, user)
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "identity_already_exists",
                    "message": "username or email is already registered",
                },
            ) from exc
        return result

    @router.post("/auth/login", response_model=TokenPair)
    def login(payload: LoginRequest, session: SessionDependency) -> TokenPair:
        now = datetime.now(UTC)
        normalized_username = normalize_username(payload.username)
        error: HTTPException | None = None
        token_pair: TokenPair | None = None

        with session.begin():
            user = session.scalar(
                select(User).where(User.normalized_username == normalized_username)
            )
            if user is None:
                consume_dummy_password_check(payload.password)
                error = _auth_error()
            elif user.locked_until is not None and user.locked_until > now:
                error = _auth_error(
                    "account is temporarily locked",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            else:
                password_valid, replacement_hash = verify_password(
                    payload.password,
                    user.password_hash,
                )
                if not password_valid:
                    user.failed_login_attempts += 1
                    if user.failed_login_attempts >= settings.login_max_attempts:
                        user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                    audit_event(
                        session,
                        action="identity.login_failed",
                        target_type="user",
                        target_id=user.id,
                        details={"failed_attempts": user.failed_login_attempts},
                    )
                    error = _auth_error()
                elif user.status != "active":
                    audit_event(
                        session,
                        action="identity.login_blocked",
                        target_type="user",
                        target_id=user.id,
                        details={"status": user.status},
                    )
                    error = _auth_error(
                        "account is not active",
                        status_code=status.HTTP_403_FORBIDDEN,
                    )
                else:
                    if replacement_hash is not None:
                        user.password_hash = replacement_hash
                    user.failed_login_attempts = 0
                    user.locked_until = None
                    user.last_login_at = now
                    user.updated_at = now
                    token_pair = _issue_token_pair(
                        session,
                        user=user,
                        settings=settings,
                        now=now,
                    )
                    audit_event(
                        session,
                        action="identity.login_succeeded",
                        target_type="session",
                        target_id=token_pair.user.id,
                        actor_user_id=user.id,
                    )

        if error is not None:
            raise error
        if token_pair is None:
            raise RuntimeError("login completed without a token pair")
        return token_pair

    @router.post("/auth/refresh", response_model=TokenPair)
    def refresh(payload: RefreshRequest, session: SessionDependency) -> TokenPair:
        now = datetime.now(UTC)
        token_hash = hash_refresh_token(payload.refresh_token)
        error: HTTPException | None = None
        token_pair: TokenPair | None = None

        with session.begin():
            old_session = session.scalar(
                select(AuthSession)
                .where(AuthSession.refresh_token_hash == token_hash)
                .with_for_update()
            )
            if (
                old_session is None
                or old_session.revoked_at is not None
                or old_session.expires_at <= now
            ):
                error = _auth_error("invalid or expired refresh token")
            else:
                user = session.get(User, old_session.user_id)
                if user is None or user.status != "active":
                    error = _auth_error("account is not active")
                else:
                    old_session.revoked_at = now
                    old_session.last_used_at = now
                    token_pair = _issue_token_pair(
                        session,
                        user=user,
                        settings=settings,
                        now=now,
                    )
                    audit_event(
                        session,
                        action="identity.refresh_rotated",
                        target_type="session",
                        target_id=old_session.id,
                        actor_user_id=user.id,
                    )

        if error is not None:
            raise error
        if token_pair is None:
            raise RuntimeError("refresh completed without a token pair")
        return token_pair

    @router.get("/auth/me", response_model=UserRead)
    def me(identity: CurrentIdentityDependency, session: SessionDependency) -> UserRead:
        with session.begin():
            user = session.get(User, identity.user.id)
            if user is None:
                raise _auth_error()
            return _user_read(session, user)

    @router.post("/auth/change-password", status_code=status.HTTP_204_NO_CONTENT)
    def change_password(
        payload: ChangePasswordRequest,
        identity: CurrentIdentityDependency,
        session: SessionDependency,
    ) -> Response:
        try:
            validate_password_strength(payload.new_password)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={"code": "weak_password", "message": str(exc)},
            ) from exc
        now = datetime.now(UTC)
        error: HTTPException | None = None

        with session.begin():
            user = session.get(User, identity.user.id)
            if user is None:
                error = _auth_error()
            else:
                current_valid, _ = verify_password(
                    payload.current_password,
                    user.password_hash,
                )
                if not current_valid:
                    error = _auth_error("current password is incorrect")
                elif payload.current_password == payload.new_password:
                    error = HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={
                            "code": "password_unchanged",
                            "message": "new password must be different",
                        },
                    )
                else:
                    user.password_hash = hash_password(payload.new_password)
                    user.must_change_password = False
                    user.password_changed_at = now
                    user.updated_at = now
                    for auth_session in session.scalars(
                        select(AuthSession).where(
                            AuthSession.user_id == user.id,
                            AuthSession.revoked_at.is_(None),
                        )
                    ).all():
                        auth_session.revoked_at = now
                    audit_event(
                        session,
                        action="identity.password_changed",
                        target_type="user",
                        target_id=user.id,
                        actor_user_id=user.id,
                    )

        if error is not None:
            raise error
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
    def logout(
        identity: CurrentIdentityDependency,
        session: SessionDependency,
    ) -> Response:
        with session.begin():
            auth_session = session.get(AuthSession, identity.session_id)
            if auth_session is not None and auth_session.revoked_at is None:
                auth_session.revoked_at = utc_now()
            audit_event(
                session,
                action="identity.logout",
                target_type="session",
                target_id=identity.session_id,
                actor_user_id=identity.user.id,
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/admin/users", response_model=UserList)
    def list_users(
        identity: CurrentIdentityDependency,
        session: SessionDependency,
        offset: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ) -> UserList:
        if "users:read" not in identity.permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
        with session.begin():
            users = session.scalars(
                select(User).order_by(User.created_at.desc()).offset(offset).limit(limit)
            ).all()
            total = int(session.scalar(select(func.count(User.id))) or 0)
            return UserList(
                items=[_user_read(session, user) for user in users],
                total=total,
            )

    def change_role(
        *,
        target_user_id: str,
        role_name: str,
        grant: bool,
        identity: CurrentIdentity,
        session: Session,
    ) -> RoleChangeRead:
        if role_name not in ASSIGNABLE_ADMIN_ROLES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "role_not_assignable",
                    "message": "only moderator and admin roles can be assigned here",
                },
            )
        if "roles:assign" not in identity.permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
        if role_name == "admin" and "super_admin" not in identity.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="only a super admin can change admin membership",
            )

        with session.begin():
            target = session.get(User, target_user_id)
            if target is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="user not found",
                )
            membership = session.get(
                UserRole,
                {"user_id": target.id, "role_name": role_name},
            )
            if grant and membership is None:
                session.add(
                    UserRole(
                        user_id=target.id,
                        role_name=role_name,
                        granted_by_user_id=identity.user.id,
                    )
                )
            elif not grant and membership is not None:
                session.delete(membership)
            audit_event(
                session,
                action=f"rbac.role_{'granted' if grant else 'revoked'}",
                target_type="user",
                target_id=target.id,
                actor_user_id=identity.user.id,
                details={"role": role_name},
            )
            session.flush()
            return RoleChangeRead(
                user_id=target.id,
                roles=get_user_roles(session, target.id),
            )

    @router.put("/admin/users/{user_id}/roles/{role_name}", response_model=RoleChangeRead)
    def grant_role(
        user_id: str,
        role_name: str,
        identity: CurrentIdentityDependency,
        session: SessionDependency,
    ) -> RoleChangeRead:
        return change_role(
            target_user_id=user_id,
            role_name=role_name,
            grant=True,
            identity=identity,
            session=session,
        )

    @router.delete(
        "/admin/users/{user_id}/roles/{role_name}",
        response_model=RoleChangeRead,
    )
    def revoke_role(
        user_id: str,
        role_name: str,
        identity: CurrentIdentityDependency,
        session: SessionDependency,
    ) -> RoleChangeRead:
        return change_role(
            target_user_id=user_id,
            role_name=role_name,
            grant=False,
            identity=identity,
            session=session,
        )

    return router
