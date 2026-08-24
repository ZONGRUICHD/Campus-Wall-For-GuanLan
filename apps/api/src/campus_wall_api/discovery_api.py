import hmac
from collections import Counter
from collections.abc import Iterator
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import String, and_, cast, delete, exists, func, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import audit_event
from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.config import Settings
from campus_wall_api.database import session_dependency
from campus_wall_api.discovery_schemas import (
    GlobalSearchResponse,
    NotificationList,
    NotificationMarkRead,
    NotificationRead,
    NotificationUnreadCount,
    OutboxDispatchResult,
    SearchClubHit,
    SearchEventHit,
    SearchHistoryList,
    SearchHistoryRead,
    SearchPostHit,
    SearchTagHit,
    SearchUserHit,
    SubscriptionList,
    SubscriptionRead,
    SubscriptionTargetType,
)
from campus_wall_api.models import (
    BOARD_VALUES,
    CampusEvent,
    Club,
    ContentSubscription,
    Notification,
    NotificationOutbox,
    Post,
    SearchHistory,
    User,
    UserBlock,
    UserFollow,
    utc_now,
)

BOARD_LABELS = {
    "news": "校园资讯",
    "daily": "校园日常",
    "lost_found": "失物招领",
    "marketplace": "二手交易",
    "confession": "表白墙",
    "tree_hole": "树洞",
}
SEARCH_TYPES = {"posts", "users", "clubs", "events", "tags"}


def _problem(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _require_ready(identity: CurrentIdentity) -> None:
    if identity.user.must_change_password:
        raise _problem(
            status.HTTP_403_FORBIDDEN,
            "password_change_required",
            "change the initial password before using discovery features",
        )


def _search_pattern(query: str) -> str:
    escaped = query.strip().casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _blocked_exists(viewer_user_id: str, other_user_id: Any) -> Any:
    return exists(
        select(UserBlock.blocker_id).where(
            or_(
                and_(
                    UserBlock.blocker_id == viewer_user_id,
                    UserBlock.blocked_id == other_user_id,
                ),
                and_(
                    UserBlock.blocker_id == other_user_id,
                    UserBlock.blocked_id == viewer_user_id,
                ),
            )
        )
    )


def _record_search(session: Session, user_id: str, query: str) -> None:
    normalized = query.casefold()
    history = session.scalar(
        select(SearchHistory).where(
            SearchHistory.user_id == user_id,
            SearchHistory.normalized_query == normalized,
        )
    )
    if history is None:
        session.add(
            SearchHistory(
                user_id=user_id,
                query=query,
                normalized_query=normalized,
            )
        )
    else:
        history.query = query
        history.created_at = utc_now()
    session.flush()
    stale_ids = session.scalars(
        select(SearchHistory.id)
        .where(SearchHistory.user_id == user_id)
        .order_by(SearchHistory.created_at.desc(), SearchHistory.id.desc())
        .offset(20)
    ).all()
    if stale_ids:
        session.execute(delete(SearchHistory).where(SearchHistory.id.in_(stale_ids)))


def _notification_read(
    session: Session,
    notification: Notification,
) -> NotificationRead:
    anonymous_actor = notification.payload.get("actor_anonymous") is True
    actor = session.get(User, notification.actor_user_id) if notification.actor_user_id else None
    if anonymous_actor:
        actor_name = "匿名同学"
        actor_user_id = None
    elif actor and actor.status != "deleted":
        actor_name = actor.display_name
        actor_user_id = actor.id
    else:
        actor_name = "校园墙系统"
        actor_user_id = None
    return NotificationRead(
        id=notification.id,
        type=notification.type,
        actor_user_id=actor_user_id,
        actor_name=actor_name,
        entity_type=notification.entity_type,
        entity_id=notification.entity_id,
        title=notification.title,
        body=notification.body,
        read=notification.read_at is not None,
        created_at=notification.created_at,
    )


def _subscription_target(
    session: Session,
    target_type: SubscriptionTargetType,
    target_id: str,
) -> tuple[str, str]:
    clean_target_id = target_id.strip()
    if target_type is SubscriptionTargetType.BOARD:
        if clean_target_id not in BOARD_VALUES:
            raise _problem(404, "subscription_target_not_found", "board was not found")
        return clean_target_id, BOARD_LABELS[clean_target_id]
    if target_type is SubscriptionTargetType.TAG:
        if not 1 <= len(clean_target_id) <= 24:
            raise _problem(422, "invalid_subscription_tag", "tag must contain 1 to 24 characters")
        return clean_target_id, f"#{clean_target_id}"
    if target_type is SubscriptionTargetType.CLUB:
        club = session.get(Club, clean_target_id)
        if club is None or club.status != "verified":
            raise _problem(404, "subscription_target_not_found", "club was not found")
        return clean_target_id, club.name
    event = session.get(CampusEvent, clean_target_id)
    if event is None or event.status != "published":
        raise _problem(404, "subscription_target_not_found", "event was not found")
    return clean_target_id, event.title


def _subscription_read(
    session: Session,
    subscription: ContentSubscription,
) -> SubscriptionRead:
    try:
        _, label = _subscription_target(
            session,
            SubscriptionTargetType(subscription.target_type),
            subscription.target_id,
        )
    except HTTPException:
        label = "已下线的订阅目标"
    return SubscriptionRead(
        target_type=subscription.target_type,
        target_id=subscription.target_id,
        label=label,
        created_at=subscription.created_at,
    )


def create_discovery_router(
    session_factory: sessionmaker[Session],
    identity_provider: IdentityProvider,
    settings: Settings,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]
    IdentityDependency = Annotated[CurrentIdentity, Depends(identity_provider)]

    @router.get("/notifications", response_model=NotificationList)
    def list_notifications(
        session: SessionDependency,
        identity: IdentityDependency,
        unread_only: bool = False,
        cursor: Annotated[str | None, Query(max_length=36)] = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 30,
    ) -> NotificationList:
        _require_ready(identity)
        with session.begin():
            filters: list[Any] = [Notification.recipient_user_id == identity.user.id]
            if unread_only:
                filters.append(Notification.read_at.is_(None))
            if cursor:
                anchor = session.get(Notification, cursor)
                if anchor is None or anchor.recipient_user_id != identity.user.id:
                    raise _problem(422, "invalid_notification_cursor", "cursor is invalid")
                filters.append(
                    or_(
                        Notification.created_at < anchor.created_at,
                        and_(
                            Notification.created_at == anchor.created_at,
                            Notification.id < anchor.id,
                        ),
                    )
                )
            statement = (
                select(Notification)
                .where(*filters)
                .order_by(Notification.created_at.desc(), Notification.id.desc())
            )
            items = session.scalars(statement.limit(limit + 1)).all()
            page_items = items[:limit]
            total = int(
                session.scalar(
                    select(func.count(Notification.id)).where(
                        Notification.recipient_user_id == identity.user.id,
                        *([Notification.read_at.is_(None)] if unread_only else []),
                    )
                )
                or 0
            )
            return NotificationList(
                items=[_notification_read(session, item) for item in page_items],
                total=total,
                next_cursor=page_items[-1].id if len(items) > limit and page_items else None,
            )

    @router.get(
        "/notifications/unread-count",
        response_model=NotificationUnreadCount,
    )
    def unread_notification_count(
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> NotificationUnreadCount:
        _require_ready(identity)
        with session.begin():
            count = session.scalar(
                select(func.count(Notification.id)).where(
                    Notification.recipient_user_id == identity.user.id,
                    Notification.read_at.is_(None),
                )
            )
            return NotificationUnreadCount(unread_count=int(count or 0))

    @router.post("/notifications/read", response_model=NotificationUnreadCount)
    def mark_notifications_read(
        payload: NotificationMarkRead,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> NotificationUnreadCount:
        _require_ready(identity)
        with session.begin():
            filters: list[Any] = [
                Notification.recipient_user_id == identity.user.id,
                Notification.read_at.is_(None),
            ]
            if not payload.all:
                filters.append(Notification.id.in_(payload.ids))
            session.execute(update(Notification).where(*filters).values(read_at=utc_now()))
            remaining = session.scalar(
                select(func.count(Notification.id)).where(
                    Notification.recipient_user_id == identity.user.id,
                    Notification.read_at.is_(None),
                )
            )
            return NotificationUnreadCount(unread_count=int(remaining or 0))

    @router.get("/subscriptions", response_model=SubscriptionList)
    def list_subscriptions(
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> SubscriptionList:
        _require_ready(identity)
        with session.begin():
            items = session.scalars(
                select(ContentSubscription)
                .where(ContentSubscription.user_id == identity.user.id)
                .order_by(ContentSubscription.created_at.desc())
            ).all()
            return SubscriptionList(
                items=[_subscription_read(session, item) for item in items],
                total=len(items),
            )

    @router.put(
        "/subscriptions/{target_type}/{target_id}",
        response_model=SubscriptionRead,
    )
    def subscribe(
        target_type: SubscriptionTargetType,
        target_id: str,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> SubscriptionRead:
        _require_ready(identity)
        with session.begin():
            clean_target_id, label = _subscription_target(session, target_type, target_id)
            key = {
                "user_id": identity.user.id,
                "target_type": target_type.value,
                "target_id": clean_target_id,
            }
            subscription = session.get(ContentSubscription, key)
            if subscription is None:
                subscription = ContentSubscription(**key)
                session.add(subscription)
                audit_event(
                    session,
                    action="discovery.subscription_created",
                    target_type=target_type.value,
                    target_id=clean_target_id,
                    actor_user_id=identity.user.id,
                )
                session.flush()
            return SubscriptionRead(
                target_type=target_type,
                target_id=clean_target_id,
                label=label,
                created_at=subscription.created_at,
            )

    @router.delete(
        "/subscriptions/{target_type}/{target_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def unsubscribe(
        target_type: SubscriptionTargetType,
        target_id: str,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> Response:
        _require_ready(identity)
        with session.begin():
            clean_target_id = target_id.strip()
            subscription = session.get(
                ContentSubscription,
                {
                    "user_id": identity.user.id,
                    "target_type": target_type.value,
                    "target_id": clean_target_id,
                },
            )
            if subscription is not None:
                session.delete(subscription)
                audit_event(
                    session,
                    action="discovery.subscription_deleted",
                    target_type=target_type.value,
                    target_id=clean_target_id,
                    actor_user_id=identity.user.id,
                )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/search", response_model=GlobalSearchResponse)
    def global_search(
        q: Annotated[str, Query(min_length=2, max_length=100)],
        session: SessionDependency,
        identity: IdentityDependency,
        types: Annotated[str, Query(max_length=100)] = "posts,users,clubs,events,tags",
        limit_per_type: Annotated[int, Query(ge=1, le=20)] = 8,
    ) -> GlobalSearchResponse:
        _require_ready(identity)
        query = q.strip()
        if len(query) < 2:
            raise _problem(422, "search_query_too_short", "search query is too short")
        requested_types = {item.strip() for item in types.split(",") if item.strip()}
        unsupported = requested_types - SEARCH_TYPES
        if not requested_types or unsupported:
            raise _problem(422, "invalid_search_types", "search types are invalid")
        pattern = _search_pattern(query)

        with session.begin():
            _record_search(session, identity.user.id, query)
            post_visibility = or_(
                Post.author_user_id.is_(None),
                ~_blocked_exists(identity.user.id, Post.author_user_id),
            )
            post_base = (
                Post.status == "published",
                Post.publication_status == "published",
                post_visibility,
            )
            post_hits: list[SearchPostHit] = []
            if "posts" in requested_types:
                posts = session.scalars(
                    select(Post)
                    .where(
                        *post_base,
                        or_(
                            func.lower(func.coalesce(Post.title, "")).like(pattern, escape="\\"),
                            func.lower(Post.body).like(pattern, escape="\\"),
                            and_(
                                Post.anonymous.is_(False),
                                func.lower(Post.author_name).like(pattern, escape="\\"),
                            ),
                            func.lower(func.coalesce(Post.location, "")).like(pattern, escape="\\"),
                            func.lower(cast(Post.tags, String)).like(pattern, escape="\\"),
                        ),
                    )
                    .order_by(Post.created_at.desc(), Post.id.desc())
                    .limit(limit_per_type)
                ).all()
                post_hits = [
                    SearchPostHit(
                        id=post.id,
                        board=post.board,
                        title=post.title,
                        excerpt=" ".join(post.body.split())[:180],
                        author_name="匿名同学" if post.anonymous else post.author_name,
                        author_user_id=None if post.anonymous else post.author_user_id,
                        tags=list(post.tags),
                        created_at=post.created_at,
                    )
                    for post in posts
                ]

            user_hits: list[SearchUserHit] = []
            if "users" in requested_types:
                users = session.scalars(
                    select(User)
                    .where(
                        User.status == "active",
                        or_(
                            User.id == identity.user.id,
                            User.profile_visibility == "campus",
                        ),
                        ~_blocked_exists(identity.user.id, User.id),
                        or_(
                            func.lower(User.username).like(pattern, escape="\\"),
                            func.lower(User.display_name).like(pattern, escape="\\"),
                            func.lower(func.coalesce(User.bio, "")).like(pattern, escape="\\"),
                        ),
                    )
                    .order_by(User.campus_verified.desc(), User.created_at.desc())
                    .limit(limit_per_type)
                ).all()
                followed_ids = set(
                    session.scalars(
                        select(UserFollow.followed_id).where(
                            UserFollow.follower_id == identity.user.id,
                            UserFollow.followed_id.in_([user.id for user in users]),
                        )
                    ).all()
                )
                user_hits = [
                    SearchUserHit(
                        id=user.id,
                        username=user.username,
                        display_name=user.display_name,
                        bio=user.bio,
                        avatar_url=user.avatar_url,
                        campus_verified=user.campus_verified,
                        is_following=user.id in followed_ids,
                    )
                    for user in users
                ]

            subscriptions = {
                (item.target_type, item.target_id)
                for item in session.scalars(
                    select(ContentSubscription).where(
                        ContentSubscription.user_id == identity.user.id
                    )
                ).all()
            }
            club_hits: list[SearchClubHit] = []
            if "clubs" in requested_types:
                clubs = session.scalars(
                    select(Club)
                    .where(
                        Club.status == "verified",
                        or_(
                            func.lower(Club.name).like(pattern, escape="\\"),
                            func.lower(Club.description).like(pattern, escape="\\"),
                            func.lower(Club.slug).like(pattern, escape="\\"),
                        ),
                    )
                    .order_by(Club.updated_at.desc())
                    .limit(limit_per_type)
                ).all()
                club_hits = [
                    SearchClubHit(
                        id=club.id,
                        slug=club.slug,
                        name=club.name,
                        description=club.description,
                        recruitment_status=club.recruitment_status,
                        subscribed=("club", club.id) in subscriptions,
                    )
                    for club in clubs
                ]

            event_hits: list[SearchEventHit] = []
            if "events" in requested_types:
                events = session.execute(
                    select(CampusEvent, Club.name)
                    .join(Club, Club.id == CampusEvent.club_id)
                    .where(
                        CampusEvent.status == "published",
                        Club.status == "verified",
                        or_(
                            func.lower(CampusEvent.title).like(pattern, escape="\\"),
                            func.lower(CampusEvent.description).like(pattern, escape="\\"),
                            func.lower(CampusEvent.location).like(pattern, escape="\\"),
                            func.lower(Club.name).like(pattern, escape="\\"),
                        ),
                    )
                    .order_by(CampusEvent.starts_at.asc())
                    .limit(limit_per_type)
                ).all()
                event_hits = [
                    SearchEventHit(
                        id=event.id,
                        club_id=event.club_id,
                        club_name=club_name,
                        title=event.title,
                        description=event.description,
                        location=event.location,
                        starts_at=event.starts_at,
                        subscribed=("event", event.id) in subscriptions,
                    )
                    for event, club_name in events
                ]

            tag_hits: list[SearchTagHit] = []
            if "tags" in requested_types:
                tag_rows = session.scalars(
                    select(Post.tags)
                    .where(
                        *post_base,
                        func.lower(cast(Post.tags, String)).like(pattern, escape="\\"),
                    )
                    .order_by(Post.created_at.desc())
                    .limit(500)
                ).all()
                tag_counts: Counter[str] = Counter(
                    tag for tags in tag_rows for tag in tags if query.casefold() in tag.casefold()
                )
                tag_hits = [
                    SearchTagHit(
                        name=tag,
                        post_count=count,
                        subscribed=("tag", tag) in subscriptions,
                    )
                    for tag, count in sorted(
                        tag_counts.items(),
                        key=lambda item: (-item[1], item[0].casefold()),
                    )[:limit_per_type]
                ]

            total = (
                len(post_hits) + len(user_hits) + len(club_hits) + len(event_hits) + len(tag_hits)
            )
            return GlobalSearchResponse(
                query=query,
                posts=post_hits,
                users=user_hits,
                clubs=club_hits,
                events=event_hits,
                tags=tag_hits,
                total=total,
            )

    @router.get("/search/history", response_model=SearchHistoryList)
    def get_search_history(
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> SearchHistoryList:
        _require_ready(identity)
        with session.begin():
            items = session.scalars(
                select(SearchHistory)
                .where(SearchHistory.user_id == identity.user.id)
                .order_by(SearchHistory.created_at.desc(), SearchHistory.id.desc())
                .limit(20)
            ).all()
            return SearchHistoryList(
                items=[
                    SearchHistoryRead(
                        id=item.id,
                        query=item.query,
                        created_at=item.created_at,
                    )
                    for item in items
                ]
            )

    @router.delete(
        "/search/history",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def clear_search_history(
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> Response:
        _require_ready(identity)
        with session.begin():
            session.execute(delete(SearchHistory).where(SearchHistory.user_id == identity.user.id))
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post(
        "/internal/notifications/dispatch",
        response_model=OutboxDispatchResult,
    )
    def dispatch_notification_outbox(
        session: SessionDependency,
        authorization: Annotated[str | None, Header()] = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ) -> OutboxDispatchResult:
        expected = f"Bearer {settings.cron_secret.get_secret_value()}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
        with session.begin():
            now = utc_now()
            items = session.scalars(
                select(NotificationOutbox)
                .where(
                    NotificationOutbox.status.in_(("pending", "failed")),
                    NotificationOutbox.available_at <= now,
                )
                .order_by(
                    NotificationOutbox.available_at.asc(),
                    NotificationOutbox.created_at.asc(),
                )
                .with_for_update(skip_locked=True)
                .limit(limit)
            ).all()
            for item in items:
                item.status = "done"
                item.attempts += 1
                item.processed_at = now
                item.last_error = None
                item.updated_at = now
            remaining = session.scalar(
                select(func.count(NotificationOutbox.id)).where(
                    NotificationOutbox.status.in_(("pending", "failed"))
                )
            )
            return OutboxDispatchResult(
                processed=len(items),
                remaining=int(remaining or 0),
            )

    return router
