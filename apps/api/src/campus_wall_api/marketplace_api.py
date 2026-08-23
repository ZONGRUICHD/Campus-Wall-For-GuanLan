from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import audit_event
from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.database import session_dependency
from campus_wall_api.marketplace_schemas import (
    MarketplaceInquiryCreate,
    MarketplaceInquiryList,
    MarketplaceInquiryRead,
    MarketplaceInquiryReply,
    MarketplaceInquiryStatus,
    MarketplaceListingRead,
    MarketplaceStatusUpdate,
)
from campus_wall_api.models import (
    MarketplaceInquiry,
    MarketplaceListing,
    Post,
    User,
    utc_now,
)

ANONYMOUS_BUYER = "匿名买家"


def _require_permission(identity: CurrentIdentity, permission: str) -> None:
    if identity.user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "password_change_required",
                "message": "change the initial password before using marketplace features",
            },
        )
    if permission not in identity.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "permission denied"},
        )


def _listing_read(listing: MarketplaceListing) -> MarketplaceListingRead:
    return MarketplaceListingRead(
        category=listing.category,
        condition=listing.item_condition,
        price_cents=listing.price_cents,
        original_price_cents=listing.original_price_cents,
        negotiable=listing.negotiable,
        trade_method=listing.trade_method,
        meetup_location=listing.meetup_location,
        status=listing.status,
        seller_user_id=listing.seller_user_id,
    )


def _inquiry_read(
    session: Session,
    inquiry: MarketplaceInquiry,
    identity: CurrentIdentity,
    *,
    can_reply: bool,
) -> MarketplaceInquiryRead:
    is_mine = inquiry.buyer_user_id == identity.user.id
    reveal_buyer = is_mine or not inquiry.anonymous or "content:moderate" in identity.permissions
    buyer_name = ANONYMOUS_BUYER
    if reveal_buyer:
        buyer = session.get(User, inquiry.buyer_user_id)
        if buyer is not None and buyer.status != "deleted":
            buyer_name = buyer.display_name
        elif buyer is not None:
            buyer_name = "已注销用户"
    return MarketplaceInquiryRead(
        id=inquiry.id,
        post_id=inquiry.post_id,
        message=inquiry.message,
        anonymous=inquiry.anonymous,
        buyer_name=buyer_name,
        seller_reply=inquiry.seller_reply,
        status=MarketplaceInquiryStatus(inquiry.status),
        is_mine=is_mine,
        can_reply=can_reply,
        created_at=inquiry.created_at,
        updated_at=inquiry.updated_at,
        replied_at=inquiry.replied_at,
    )


def _published_listing(
    session: Session,
    post_id: int,
    *,
    for_update: bool = False,
) -> tuple[Post, MarketplaceListing]:
    statement = (
        select(Post, MarketplaceListing)
        .join(MarketplaceListing, MarketplaceListing.post_id == Post.id)
        .where(
            Post.id == post_id,
            Post.board == "marketplace",
            Post.status == "published",
            Post.publication_status == "published",
            MarketplaceListing.review_status == "clear",
            MarketplaceListing.status != "withdrawn",
        )
    )
    if for_update:
        statement = statement.with_for_update()
    row = session.execute(statement).one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "marketplace_listing_not_found",
                "message": "marketplace listing not found",
            },
        )
    return row


def create_marketplace_router(
    session_factory: sessionmaker[Session],
    identity_provider: IdentityProvider,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]
    IdentityDependency = Annotated[CurrentIdentity, Depends(identity_provider)]

    @router.get("/inquiries/me", response_model=MarketplaceInquiryList)
    def list_my_inquiries(
        session: SessionDependency,
        identity: IdentityDependency,
        post_id: Annotated[int | None, Query(ge=1)] = None,
    ) -> MarketplaceInquiryList:
        _require_permission(identity, "content:interact")
        with session.begin():
            statement = select(MarketplaceInquiry).where(
                MarketplaceInquiry.buyer_user_id == identity.user.id
            )
            if post_id is not None:
                statement = statement.where(MarketplaceInquiry.post_id == post_id)
            inquiries = session.scalars(
                statement.order_by(MarketplaceInquiry.created_at.desc()).limit(100)
            ).all()
            return MarketplaceInquiryList(
                items=[
                    _inquiry_read(session, inquiry, identity, can_reply=False)
                    for inquiry in inquiries
                ]
            )

    @router.patch("/{post_id}/status", response_model=MarketplaceListingRead)
    def update_listing_status(
        post_id: int,
        payload: MarketplaceStatusUpdate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> MarketplaceListingRead:
        _require_permission(identity, "content:create")
        with session.begin():
            post, listing = _published_listing(session, post_id, for_update=True)
            is_author = post.author_user_id == identity.user.id
            is_moderator = "content:moderate" in identity.permissions
            if not is_author and not is_moderator:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            if not is_author and payload.status.value != "withdrawn":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "moderator_status_restricted",
                        "message": "moderators may only withdraw a listing",
                    },
                )
            now = utc_now()
            listing.status = payload.status.value
            listing.updated_at = now
            if listing.status in {"sold", "withdrawn"}:
                inquiries = session.scalars(
                    select(MarketplaceInquiry).where(
                        MarketplaceInquiry.post_id == post.id,
                        MarketplaceInquiry.status.in_(("pending", "replied")),
                    )
                ).all()
                for inquiry in inquiries:
                    inquiry.status = "closed"
                    inquiry.updated_at = now
            audit_event(
                session,
                action="marketplace.status_updated",
                target_type="post",
                target_id=str(post.id),
                actor_user_id=identity.user.id,
                details={"status": listing.status},
            )
            return _listing_read(listing)

    @router.post(
        "/{post_id}/inquiries",
        response_model=MarketplaceInquiryRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_inquiry(
        post_id: int,
        payload: MarketplaceInquiryCreate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> MarketplaceInquiryRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            post, listing = _published_listing(session, post_id, for_update=True)
            if post.author_user_id == identity.user.id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "seller_inquiry_forbidden",
                        "message": "sellers cannot inquire about their own listing",
                    },
                )
            if listing.status not in {"available", "reserved"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "marketplace_listing_unavailable",
                        "message": "this listing is no longer accepting inquiries",
                    },
                )
            inquiry = session.scalar(
                select(MarketplaceInquiry)
                .where(
                    MarketplaceInquiry.post_id == post.id,
                    MarketplaceInquiry.buyer_user_id == identity.user.id,
                )
                .with_for_update()
            )
            now = utc_now()
            action = "marketplace.inquiry_created"
            if inquiry is not None and inquiry.status in {"pending", "replied"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "marketplace_inquiry_exists",
                        "message": "an active inquiry already exists for this listing",
                    },
                )
            if inquiry is None:
                inquiry = MarketplaceInquiry(
                    post_id=post.id,
                    buyer_user_id=identity.user.id,
                    message=payload.message,
                    anonymous=payload.anonymous,
                )
                session.add(inquiry)
            else:
                inquiry.message = payload.message
                inquiry.anonymous = payload.anonymous
                inquiry.seller_reply = None
                inquiry.status = "pending"
                inquiry.replied_at = None
                inquiry.updated_at = now
                action = "marketplace.inquiry_resubmitted"
            session.flush()
            audit_event(
                session,
                action=action,
                target_type="marketplace_inquiry",
                target_id=inquiry.id,
                actor_user_id=identity.user.id,
                details={"post_id": post.id, "anonymous": inquiry.anonymous},
            )
            return _inquiry_read(session, inquiry, identity, can_reply=False)

    @router.get("/{post_id}/inquiries", response_model=MarketplaceInquiryList)
    def list_listing_inquiries(
        post_id: int,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> MarketplaceInquiryList:
        _require_permission(identity, "content:create")
        with session.begin():
            post, _ = _published_listing(session, post_id)
            is_author = post.author_user_id == identity.user.id
            if not is_author and "content:moderate" not in identity.permissions:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            inquiries = session.scalars(
                select(MarketplaceInquiry)
                .where(MarketplaceInquiry.post_id == post.id)
                .order_by(MarketplaceInquiry.created_at.desc())
            ).all()
            return MarketplaceInquiryList(
                items=[
                    _inquiry_read(
                        session,
                        inquiry,
                        identity,
                        can_reply=is_author and inquiry.status in {"pending", "replied"},
                    )
                    for inquiry in inquiries
                ]
            )

    @router.patch(
        "/{post_id}/inquiries/{inquiry_id}",
        response_model=MarketplaceInquiryRead,
    )
    def reply_to_inquiry(
        post_id: int,
        inquiry_id: str,
        payload: MarketplaceInquiryReply,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> MarketplaceInquiryRead:
        _require_permission(identity, "content:create")
        with session.begin():
            post, _ = _published_listing(session, post_id, for_update=True)
            if post.author_user_id != identity.user.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "seller_reply_forbidden",
                        "message": "only the seller may reply to an inquiry",
                    },
                )
            inquiry = session.scalar(
                select(MarketplaceInquiry)
                .where(
                    MarketplaceInquiry.id == inquiry_id,
                    MarketplaceInquiry.post_id == post.id,
                )
                .with_for_update()
            )
            if inquiry is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if inquiry.status not in {"pending", "replied"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "marketplace_inquiry_not_replyable",
                        "message": "this inquiry cannot receive another reply",
                    },
                )
            now = utc_now()
            inquiry.seller_reply = payload.seller_reply
            inquiry.status = MarketplaceInquiryStatus(payload.status).value
            inquiry.replied_at = now
            inquiry.updated_at = now
            audit_event(
                session,
                action="marketplace.inquiry_replied",
                target_type="marketplace_inquiry",
                target_id=inquiry.id,
                actor_user_id=identity.user.id,
                details={"status": inquiry.status},
            )
            return _inquiry_read(
                session,
                inquiry,
                identity,
                can_reply=inquiry.status == "replied",
            )

    @router.delete(
        "/{post_id}/inquiries/{inquiry_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def cancel_inquiry(
        post_id: int,
        inquiry_id: str,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> Response:
        _require_permission(identity, "content:interact")
        with session.begin():
            inquiry = session.scalar(
                select(MarketplaceInquiry)
                .where(
                    MarketplaceInquiry.id == inquiry_id,
                    MarketplaceInquiry.post_id == post_id,
                )
                .with_for_update()
            )
            if inquiry is None or inquiry.buyer_user_id != identity.user.id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if inquiry.status not in {"pending", "replied"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "marketplace_inquiry_not_cancellable",
                        "message": "this inquiry cannot be cancelled",
                    },
                )
            inquiry.status = "cancelled"
            inquiry.updated_at = utc_now()
            audit_event(
                session,
                action="marketplace.inquiry_cancelled",
                target_type="marketplace_inquiry",
                target_id=inquiry.id,
                actor_user_id=identity.user.id,
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
