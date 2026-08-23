from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import audit_event
from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.database import session_dependency
from campus_wall_api.lost_found_schemas import (
    LostFoundClaimCreate,
    LostFoundClaimList,
    LostFoundClaimRead,
    LostFoundClaimReview,
    LostFoundClaimStatus,
)
from campus_wall_api.models import LostFoundClaim, Post, User, utc_now


def _require_permission(identity: CurrentIdentity, permission: str) -> None:
    if identity.user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "password_change_required",
                "message": "change the initial password before using campus features",
            },
        )
    if permission not in identity.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "permission denied"},
        )


def _can_review(post: Post, identity: CurrentIdentity) -> bool:
    return (
        post.author_user_id == identity.user.id
        or "content:moderate" in identity.permissions
    )


def _claim_read(
    session: Session,
    claim: LostFoundClaim,
    post: Post,
    identity: CurrentIdentity,
) -> LostFoundClaimRead:
    is_mine = claim.claimant_user_id == identity.user.id
    reviewer = _can_review(post, identity)
    claimant = session.get(User, claim.claimant_user_id)
    if claim.anonymous and not is_mine and "content:moderate" not in identity.permissions:
        claimant_name = "匿名线索"
    elif claimant is None or claimant.status == "deleted":
        claimant_name = "已注销用户"
    else:
        claimant_name = claimant.display_name
    return LostFoundClaimRead(
        id=claim.id,
        post_id=claim.post_id,
        message=claim.message,
        anonymous=claim.anonymous,
        claimant_name=claimant_name,
        status=LostFoundClaimStatus(claim.status),
        is_mine=is_mine,
        can_review=reviewer and not is_mine and claim.status == "pending",
        created_at=claim.created_at,
        updated_at=claim.updated_at,
        reviewed_at=claim.reviewed_at,
    )


def _published_lost_found_post(session: Session, post_id: int) -> Post:
    post = session.scalar(
        select(Post).where(
            Post.id == post_id,
            Post.board == "lost_found",
            Post.status == "published",
            Post.publication_status == "published",
        )
    )
    if post is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "lost_found_not_found",
                "message": "lost-and-found post not found",
            },
        )
    return post


def create_lost_found_router(
    session_factory: sessionmaker[Session],
    identity_provider: IdentityProvider,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1/lost-found", tags=["lost-and-found"])

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]
    IdentityDependency = Annotated[CurrentIdentity, Depends(identity_provider)]

    @router.post(
        "/{post_id}/claims",
        response_model=LostFoundClaimRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_claim(
        post_id: int,
        payload: LostFoundClaimCreate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> LostFoundClaimRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            post = session.scalar(
                select(Post)
                .where(
                    Post.id == post_id,
                    Post.board == "lost_found",
                    Post.status == "published",
                    Post.publication_status == "published",
                )
                .with_for_update()
            )
            if post is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={
                        "code": "lost_found_not_found",
                        "message": "lost-and-found post not found",
                    },
                )
            if post.resolved:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "item_already_resolved",
                        "message": "this lost-and-found item is already resolved",
                    },
                )
            if post.author_user_id == identity.user.id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "author_cannot_claim",
                        "message": "authors cannot submit a claim on their own item",
                    },
                )

            claim = session.scalar(
                select(LostFoundClaim)
                .where(
                    LostFoundClaim.post_id == post_id,
                    LostFoundClaim.claimant_user_id == identity.user.id,
                )
                .with_for_update()
            )
            now = utc_now()
            action = "lost_found.claim_created"
            if claim is None:
                claim = LostFoundClaim(
                    post_id=post_id,
                    claimant_user_id=identity.user.id,
                    message=payload.message,
                    anonymous=payload.anonymous,
                )
                session.add(claim)
            elif claim.status in {"rejected", "cancelled"}:
                claim.message = payload.message
                claim.anonymous = payload.anonymous
                claim.status = "pending"
                claim.reviewed_by_user_id = None
                claim.reviewed_at = None
                claim.updated_at = now
                action = "lost_found.claim_resubmitted"
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "claim_already_exists",
                        "message": "an active claim already exists for this item",
                    },
                )
            session.flush()
            audit_event(
                session,
                action=action,
                target_type="lost_found_claim",
                target_id=claim.id,
                actor_user_id=identity.user.id,
                details={"post_id": post_id, "anonymous": payload.anonymous},
            )
            return _claim_read(session, claim, post, identity)

    @router.get(
        "/{post_id}/claims",
        response_model=LostFoundClaimList,
    )
    def list_post_claims(
        post_id: int,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> LostFoundClaimList:
        _require_permission(identity, "content:interact")
        with session.begin():
            post = _published_lost_found_post(session, post_id)
            if not _can_review(post, identity):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "forbidden",
                        "message": "only the author or a moderator can review claims",
                    },
                )
            claims = session.scalars(
                select(LostFoundClaim)
                .where(LostFoundClaim.post_id == post_id)
                .order_by(LostFoundClaim.created_at.desc())
                .limit(100)
            ).all()
            return LostFoundClaimList(
                items=[
                    _claim_read(session, claim, post, identity)
                    for claim in claims
                ],
                total=len(claims),
            )

    @router.get("/claims/me", response_model=LostFoundClaimList)
    def list_my_claims(
        session: SessionDependency,
        identity: IdentityDependency,
        post_id: Annotated[int | None, Query(ge=1)] = None,
    ) -> LostFoundClaimList:
        _require_permission(identity, "content:interact")
        statement = select(LostFoundClaim).where(
            LostFoundClaim.claimant_user_id == identity.user.id
        )
        if post_id is not None:
            statement = statement.where(LostFoundClaim.post_id == post_id)
        with session.begin():
            claims = session.scalars(
                statement.order_by(LostFoundClaim.created_at.desc()).limit(100)
            ).all()
            items: list[LostFoundClaimRead] = []
            for claim in claims:
                post = session.get(Post, claim.post_id)
                if post is not None:
                    items.append(_claim_read(session, claim, post, identity))
            return LostFoundClaimList(items=items, total=len(items))

    @router.patch(
        "/{post_id}/claims/{claim_id}",
        response_model=LostFoundClaimRead,
    )
    def review_claim(
        post_id: int,
        claim_id: str,
        payload: LostFoundClaimReview,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> LostFoundClaimRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            post = session.scalar(
                select(Post)
                .where(
                    Post.id == post_id,
                    Post.board == "lost_found",
                    Post.status == "published",
                    Post.publication_status == "published",
                )
                .with_for_update()
            )
            if post is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if not _can_review(post, identity):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "forbidden",
                        "message": "only the author or a moderator can review claims",
                    },
                )
            claim = session.scalar(
                select(LostFoundClaim)
                .where(
                    LostFoundClaim.id == claim_id,
                    LostFoundClaim.post_id == post_id,
                )
                .with_for_update()
            )
            if claim is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={
                        "code": "claim_not_found",
                        "message": "lost-and-found claim not found",
                    },
                )
            if claim.claimant_user_id == identity.user.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "self_review_forbidden",
                        "message": "reviewers cannot review their own claim",
                    },
                )
            if claim.status != "pending":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "claim_already_reviewed",
                        "message": "this claim has already been reviewed",
                    },
                )
            if (
                payload.status is LostFoundClaimStatus.ACCEPTED
                and post.resolved
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "item_already_resolved",
                        "message": "this lost-and-found item is already resolved",
                    },
                )

            now = utc_now()
            claim.status = payload.status.value
            claim.reviewed_by_user_id = identity.user.id
            claim.reviewed_at = now
            claim.updated_at = now
            if payload.status is LostFoundClaimStatus.ACCEPTED:
                post.resolved = True
                post.updated_at = now
                other_claims = session.scalars(
                    select(LostFoundClaim)
                    .where(
                        LostFoundClaim.post_id == post_id,
                        LostFoundClaim.id != claim.id,
                        LostFoundClaim.status == "pending",
                    )
                    .with_for_update()
                ).all()
                for other_claim in other_claims:
                    other_claim.status = "rejected"
                    other_claim.reviewed_by_user_id = identity.user.id
                    other_claim.reviewed_at = now
                    other_claim.updated_at = now
            audit_event(
                session,
                action=f"lost_found.claim_{payload.status.value}",
                target_type="lost_found_claim",
                target_id=claim.id,
                actor_user_id=identity.user.id,
                details={"post_id": post_id},
            )
            session.flush()
            return _claim_read(session, claim, post, identity)

    @router.delete(
        "/{post_id}/claims/{claim_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def cancel_claim(
        post_id: int,
        claim_id: str,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> Response:
        _require_permission(identity, "content:interact")
        with session.begin():
            claim = session.scalar(
                select(LostFoundClaim)
                .where(
                    LostFoundClaim.id == claim_id,
                    LostFoundClaim.post_id == post_id,
                )
                .with_for_update()
            )
            if claim is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={
                        "code": "claim_not_found",
                        "message": "lost-and-found claim not found",
                    },
                )
            if claim.claimant_user_id != identity.user.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "forbidden",
                        "message": "only the claimant can cancel this claim",
                    },
                )
            if claim.status != "pending":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "claim_not_cancellable",
                        "message": "only pending claims can be cancelled",
                    },
                )
            now = utc_now()
            claim.status = "cancelled"
            claim.updated_at = now
            audit_event(
                session,
                action="lost_found.claim_cancelled",
                target_type="lost_found_claim",
                target_id=claim.id,
                actor_user_id=identity.user.id,
                details={"post_id": post_id},
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
