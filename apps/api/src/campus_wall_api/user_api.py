import secrets
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import audit_event
from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.config import Settings
from campus_wall_api.database import session_dependency
from campus_wall_api.models import (
    AuthSession,
    CampusVerification,
    Comment,
    CommentReaction,
    Post,
    PostBookmark,
    Reaction,
    User,
    UserBlock,
    UserFollow,
    UserRole,
    utc_now,
)
from campus_wall_api.security import hash_password, hash_private_value, verify_password
from campus_wall_api.user_schemas import (
    AccountDeleteRequest,
    AccountDeleteResult,
    CampusVerificationCreate,
    CampusVerificationList,
    CampusVerificationRead,
    CampusVerificationReview,
    PrivacyUpdate,
    ProfileUpdate,
    RelationshipRead,
    SessionList,
    SessionRead,
    UserProfileRead,
)


def _require_ready(identity: CurrentIdentity) -> None:
    if identity.user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "password_change_required",
                "message": "change the initial password before using account features",
            },
        )


def _verification_read(verification: CampusVerification) -> CampusVerificationRead:
    return CampusVerificationRead(
        id=verification.id,
        user_id=verification.user_id,
        school_name=verification.school_name,
        proof_object_key=verification.proof_object_key,
        status=verification.status,
        review_note=verification.review_note,
        reviewed_by_user_id=verification.reviewed_by_user_id,
        reviewed_at=verification.reviewed_at,
        created_at=verification.created_at,
        updated_at=verification.updated_at,
    )


def _profile_read(
    session: Session,
    *,
    user: User,
    viewer_id: str,
) -> UserProfileRead:
    follower_count = int(
        session.scalar(
            select(func.count(UserFollow.follower_id)).where(UserFollow.followed_id == user.id)
        )
        or 0
    )
    following_count = int(
        session.scalar(
            select(func.count(UserFollow.followed_id)).where(UserFollow.follower_id == user.id)
        )
        or 0
    )
    is_following = (
        session.get(
            UserFollow,
            {"follower_id": viewer_id, "followed_id": user.id},
        )
        is not None
    )
    is_blocked = (
        session.get(
            UserBlock,
            {"blocker_id": viewer_id, "blocked_id": user.id},
        )
        is not None
    )
    return UserProfileRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        bio=user.bio,
        avatar_url=user.avatar_url,
        campus_verified=user.campus_verified,
        level=user.level,
        reputation=user.reputation,
        profile_visibility=user.profile_visibility,
        show_activity=user.show_activity,
        allow_direct_messages=user.allow_direct_messages,
        follower_count=follower_count,
        following_count=following_count,
        is_following=is_following,
        is_blocked=is_blocked,
        created_at=user.created_at,
    )


def create_user_router(
    session_factory: sessionmaker[Session],
    settings: Settings,
    identity_provider: IdentityProvider,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]
    IdentityDependency = Annotated[CurrentIdentity, Depends(identity_provider)]

    @router.get("/users/me/profile", response_model=UserProfileRead)
    def get_my_profile(
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> UserProfileRead:
        _require_ready(identity)
        with session.begin():
            user = session.get(User, identity.user.id)
            if user is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            return _profile_read(session, user=user, viewer_id=user.id)

    @router.patch("/users/me/profile", response_model=UserProfileRead)
    def update_my_profile(
        payload: ProfileUpdate,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> UserProfileRead:
        _require_ready(identity)
        changes = payload.model_dump(exclude_unset=True)
        if not changes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="at least one profile field is required",
            )
        with session.begin():
            user = session.get(User, identity.user.id)
            if user is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            for field, value in changes.items():
                setattr(user, field, value)
            user.updated_at = utc_now()
            audit_event(
                session,
                action="profile.updated",
                target_type="user",
                target_id=user.id,
                actor_user_id=user.id,
                details={"fields": sorted(changes)},
            )
            session.flush()
            return _profile_read(session, user=user, viewer_id=user.id)

    @router.patch("/users/me/privacy", response_model=UserProfileRead)
    def update_my_privacy(
        payload: PrivacyUpdate,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> UserProfileRead:
        _require_ready(identity)
        changes = payload.model_dump(exclude_unset=True)
        if not changes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="at least one privacy field is required",
            )
        with session.begin():
            user = session.get(User, identity.user.id)
            if user is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            for field, value in changes.items():
                setattr(user, field, value.value if hasattr(value, "value") else value)
            user.updated_at = utc_now()
            audit_event(
                session,
                action="privacy.updated",
                target_type="user",
                target_id=user.id,
                actor_user_id=user.id,
                details={"fields": sorted(changes)},
            )
            session.flush()
            return _profile_read(session, user=user, viewer_id=user.id)

    @router.get("/users/{user_id}/profile", response_model=UserProfileRead)
    def get_user_profile(
        user_id: str,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> UserProfileRead:
        _require_ready(identity)
        with session.begin():
            user = session.get(User, user_id)
            blocked = session.scalar(
                select(UserBlock.blocker_id).where(
                    or_(
                        (
                            (UserBlock.blocker_id == identity.user.id)
                            & (UserBlock.blocked_id == user_id)
                        ),
                        (
                            (UserBlock.blocker_id == user_id)
                            & (UserBlock.blocked_id == identity.user.id)
                        ),
                    )
                )
            )
            if (
                user is None
                or user.status != "active"
                or blocked is not None
                or (
                    user.profile_visibility == "private"
                    and user.id != identity.user.id
                    and "users:read" not in identity.permissions
                )
            ):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="profile not found",
                )
            return _profile_read(
                session,
                user=user,
                viewer_id=identity.user.id,
            )

    @router.get("/users/me/sessions", response_model=SessionList)
    def list_my_sessions(
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> SessionList:
        _require_ready(identity)
        with session.begin():
            sessions = session.scalars(
                select(AuthSession)
                .where(
                    AuthSession.user_id == identity.user.id,
                    AuthSession.revoked_at.is_(None),
                    AuthSession.expires_at > utc_now(),
                )
                .order_by(AuthSession.created_at.desc())
            ).all()
            return SessionList(
                items=[
                    SessionRead(
                        id=item.id,
                        user_agent=item.user_agent,
                        created_at=item.created_at,
                        last_used_at=item.last_used_at,
                        expires_at=item.expires_at,
                        current=item.id == identity.session_id,
                    )
                    for item in sessions
                ]
            )

    @router.delete(
        "/users/me/sessions/{session_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def revoke_my_session(
        session_id: str,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> Response:
        _require_ready(identity)
        with session.begin():
            auth_session = session.get(AuthSession, session_id)
            if auth_session is None or auth_session.user_id != identity.user.id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="session not found",
                )
            if auth_session.revoked_at is None:
                auth_session.revoked_at = utc_now()
            audit_event(
                session,
                action="identity.session_revoked",
                target_type="session",
                target_id=auth_session.id,
                actor_user_id=identity.user.id,
                details={"current": auth_session.id == identity.session_id},
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    def update_relationship(
        *,
        target_user_id: str,
        action: str,
        identity: CurrentIdentity,
        session: Session,
    ) -> RelationshipRead:
        _require_ready(identity)
        if target_user_id == identity.user.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="cannot create a relationship with yourself",
            )
        with session.begin():
            target = session.get(User, target_user_id)
            if target is None or target.status != "active":
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="user not found",
                )
            follow_key = {
                "follower_id": identity.user.id,
                "followed_id": target.id,
            }
            block_key = {
                "blocker_id": identity.user.id,
                "blocked_id": target.id,
            }
            follow = session.get(UserFollow, follow_key)
            block = session.get(UserBlock, block_key)
            reverse_block = session.get(
                UserBlock,
                {"blocker_id": target.id, "blocked_id": identity.user.id},
            )

            if action == "follow":
                if block is not None or reverse_block is not None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="blocked users cannot follow each other",
                    )
                if follow is None:
                    session.add(UserFollow(**follow_key))
            elif action == "unfollow":
                if follow is not None:
                    session.delete(follow)
            elif action == "block":
                if block is None:
                    session.add(UserBlock(**block_key))
                session.execute(
                    delete(UserFollow).where(
                        or_(
                            (
                                (UserFollow.follower_id == identity.user.id)
                                & (UserFollow.followed_id == target.id)
                            ),
                            (
                                (UserFollow.follower_id == target.id)
                                & (UserFollow.followed_id == identity.user.id)
                            ),
                        )
                    )
                )
            elif action == "unblock" and block is not None:
                session.delete(block)

            audit_event(
                session,
                action=f"relationship.{action}",
                target_type="user",
                target_id=target.id,
                actor_user_id=identity.user.id,
            )
            session.flush()
            return RelationshipRead(
                user_id=target.id,
                following=(
                    session.get(UserFollow, follow_key) is not None if action != "block" else False
                ),
                blocked=(
                    session.get(UserBlock, block_key) is not None if action != "unblock" else False
                ),
            )

    @router.put("/users/{user_id}/follow", response_model=RelationshipRead)
    def follow_user(
        user_id: str,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> RelationshipRead:
        return update_relationship(
            target_user_id=user_id,
            action="follow",
            identity=identity,
            session=session,
        )

    @router.delete("/users/{user_id}/follow", response_model=RelationshipRead)
    def unfollow_user(
        user_id: str,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> RelationshipRead:
        return update_relationship(
            target_user_id=user_id,
            action="unfollow",
            identity=identity,
            session=session,
        )

    @router.put("/users/{user_id}/block", response_model=RelationshipRead)
    def block_user(
        user_id: str,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> RelationshipRead:
        return update_relationship(
            target_user_id=user_id,
            action="block",
            identity=identity,
            session=session,
        )

    @router.delete("/users/{user_id}/block", response_model=RelationshipRead)
    def unblock_user(
        user_id: str,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> RelationshipRead:
        return update_relationship(
            target_user_id=user_id,
            action="unblock",
            identity=identity,
            session=session,
        )

    @router.post(
        "/users/me/campus-verification",
        response_model=CampusVerificationRead,
        status_code=status.HTTP_201_CREATED,
    )
    def submit_campus_verification(
        payload: CampusVerificationCreate,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> CampusVerificationRead:
        _require_ready(identity)
        if payload.proof_object_key and not payload.proof_object_key.startswith(
            f"verifications/{identity.user.id}/"
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="proof object does not belong to the current user",
            )
        identifier_hash = hash_private_value(
            payload.student_identifier.get_secret_value(),
            settings,
        )
        try:
            with session.begin():
                current = session.scalar(
                    select(CampusVerification)
                    .where(CampusVerification.user_id == identity.user.id)
                    .order_by(CampusVerification.created_at.desc())
                )
                if current is not None and current.status in {"pending", "approved"}:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="a pending or approved verification already exists",
                    )
                verification = CampusVerification(
                    user_id=identity.user.id,
                    school_name=payload.school_name,
                    student_identifier_hash=identifier_hash,
                    proof_object_key=payload.proof_object_key,
                )
                session.add(verification)
                session.flush()
                audit_event(
                    session,
                    action="verification.submitted",
                    target_type="campus_verification",
                    target_id=verification.id,
                    actor_user_id=identity.user.id,
                )
                return _verification_read(verification)
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="this campus identity is already in use",
            ) from exc

    @router.get(
        "/users/me/campus-verification",
        response_model=CampusVerificationRead | None,
    )
    def get_my_campus_verification(
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> CampusVerificationRead | None:
        _require_ready(identity)
        with session.begin():
            verification = session.scalar(
                select(CampusVerification)
                .where(CampusVerification.user_id == identity.user.id)
                .order_by(CampusVerification.created_at.desc())
            )
            return _verification_read(verification) if verification else None

    @router.get(
        "/admin/campus-verifications",
        response_model=CampusVerificationList,
    )
    def list_campus_verifications(
        identity: IdentityDependency,
        session: SessionDependency,
        verification_status: Annotated[
            str,
            Query(alias="status", pattern="^(pending|approved|rejected)$"),
        ] = "pending",
        offset: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ) -> CampusVerificationList:
        _require_ready(identity)
        if "users:manage" not in identity.permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
        with session.begin():
            filters = CampusVerification.status == verification_status
            items = session.scalars(
                select(CampusVerification)
                .where(filters)
                .order_by(CampusVerification.created_at.asc())
                .offset(offset)
                .limit(limit)
            ).all()
            total = int(
                session.scalar(select(func.count(CampusVerification.id)).where(filters)) or 0
            )
            return CampusVerificationList(
                items=[_verification_read(item) for item in items],
                total=total,
            )

    @router.patch(
        "/admin/campus-verifications/{verification_id}",
        response_model=CampusVerificationRead,
    )
    def review_campus_verification(
        verification_id: str,
        payload: CampusVerificationReview,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> CampusVerificationRead:
        _require_ready(identity)
        if "users:manage" not in identity.permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
        with session.begin():
            verification = session.scalar(
                select(CampusVerification)
                .where(CampusVerification.id == verification_id)
                .with_for_update()
            )
            if verification is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if verification.status != "pending":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="verification was already reviewed",
                )
            now = utc_now()
            verification.status = payload.status.value
            verification.review_note = payload.review_note
            verification.reviewed_by_user_id = identity.user.id
            verification.reviewed_at = now
            verification.updated_at = now
            user = session.get(User, verification.user_id)
            if user is not None:
                user.campus_verified = payload.status.value == "approved"
                user.updated_at = now
            audit_event(
                session,
                action=f"verification.{payload.status.value}",
                target_type="campus_verification",
                target_id=verification.id,
                actor_user_id=identity.user.id,
                details={"subject_user_id": verification.user_id},
            )
            session.flush()
            return _verification_read(verification)

    @router.post("/users/me/delete", response_model=AccountDeleteResult)
    def delete_my_account(
        payload: AccountDeleteRequest,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> AccountDeleteResult:
        _require_ready(identity)
        if "super_admin" in identity.roles:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="a super admin account cannot be self-deleted",
            )
        error: HTTPException | None = None
        revoked_sessions = 0
        with session.begin():
            user = session.get(User, identity.user.id)
            if user is None:
                error = HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            elif not verify_password(payload.password, user.password_hash)[0]:
                error = HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="password is incorrect",
                )
            else:
                now = utc_now()
                active_sessions = session.scalars(
                    select(AuthSession).where(
                        AuthSession.user_id == user.id,
                        AuthSession.revoked_at.is_(None),
                    )
                ).all()
                for auth_session in active_sessions:
                    auth_session.revoked_at = now
                revoked_sessions = len(active_sessions)
                session.execute(
                    update(Post)
                    .where(Post.author_user_id == user.id)
                    .values(author_user_id=None, author_name="已注销用户")
                )
                session.execute(
                    update(Comment)
                    .where(Comment.author_user_id == user.id)
                    .values(author_user_id=None, author_name="已注销用户")
                )
                session.execute(delete(Reaction).where(Reaction.actor == user.id))
                session.execute(delete(CommentReaction).where(CommentReaction.user_id == user.id))
                session.execute(delete(PostBookmark).where(PostBookmark.user_id == user.id))
                session.execute(
                    delete(UserFollow).where(
                        or_(
                            UserFollow.follower_id == user.id,
                            UserFollow.followed_id == user.id,
                        )
                    )
                )
                session.execute(
                    delete(UserBlock).where(
                        or_(
                            UserBlock.blocker_id == user.id,
                            UserBlock.blocked_id == user.id,
                        )
                    )
                )
                session.execute(delete(UserRole).where(UserRole.user_id == user.id))
                user.username = f"deleted-{user.id[:12]}"
                user.normalized_username = user.username
                user.email = None
                user.display_name = "已注销用户"
                user.bio = None
                user.avatar_url = None
                user.password_hash = hash_password(f"Deleted1{secrets.token_urlsafe(32)}")
                user.status = "deleted"
                user.updated_at = now
                audit_event(
                    session,
                    action="identity.account_deleted",
                    target_type="user",
                    target_id=user.id,
                    actor_user_id=user.id,
                )

        if error is not None:
            raise error
        return AccountDeleteResult(revoked_sessions=revoked_sessions)

    return router
