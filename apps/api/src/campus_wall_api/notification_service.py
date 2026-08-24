from collections.abc import Iterable

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session

from campus_wall_api.models import (
    ClubMembership,
    ContentSubscription,
    Notification,
    NotificationOutbox,
    Post,
    User,
    UserBlock,
)


def _users_are_blocked(session: Session, left_user_id: str, right_user_id: str) -> bool:
    return (
        session.scalar(
            select(UserBlock.blocker_id).where(
                or_(
                    and_(
                        UserBlock.blocker_id == left_user_id,
                        UserBlock.blocked_id == right_user_id,
                    ),
                    and_(
                        UserBlock.blocker_id == right_user_id,
                        UserBlock.blocked_id == left_user_id,
                    ),
                )
            )
        )
        is not None
    )


def create_notification(
    session: Session,
    *,
    recipient_user_id: str | None,
    notification_type: str,
    entity_type: str,
    entity_id: str,
    title: str,
    body: str,
    dedupe_key: str,
    actor_user_id: str | None = None,
    payload: dict[str, object] | None = None,
) -> Notification | None:
    if recipient_user_id is None or recipient_user_id == actor_user_id:
        return None
    recipient = session.get(User, recipient_user_id)
    if recipient is None or recipient.status != "active":
        return None
    if actor_user_id and _users_are_blocked(session, recipient_user_id, actor_user_id):
        return None
    existing = session.scalar(select(Notification).where(Notification.dedupe_key == dedupe_key))
    if existing is not None:
        return existing

    notification = Notification(
        recipient_user_id=recipient_user_id,
        actor_user_id=actor_user_id,
        type=notification_type,
        entity_type=entity_type,
        entity_id=entity_id,
        title=title[:120],
        body=body[:500],
        payload=payload or {},
        dedupe_key=dedupe_key,
    )
    session.add(notification)
    session.flush()
    session.add(
        NotificationOutbox(
            event_type="notification.created",
            aggregate_type="notification",
            aggregate_id=notification.id,
            payload={
                "notification_id": notification.id,
                "recipient_user_id": recipient_user_id,
            },
            dedupe_key=f"deliver:{notification.id}",
        )
    )
    return notification


def remove_notification(session: Session, *, dedupe_key: str) -> None:
    notification_id = session.scalar(
        select(Notification.id).where(Notification.dedupe_key == dedupe_key)
    )
    if notification_id is None:
        return
    session.execute(
        delete(NotificationOutbox).where(
            NotificationOutbox.aggregate_type == "notification",
            NotificationOutbox.aggregate_id == notification_id,
            NotificationOutbox.status.in_(("pending", "processing")),
        )
    )
    session.execute(delete(Notification).where(Notification.id == notification_id))


def _notify_subscribers(
    session: Session,
    *,
    subscriber_ids: Iterable[str],
    actor_user_id: str | None,
    notification_type: str,
    entity_type: str,
    entity_id: str,
    title: str,
    body: str,
    dedupe_prefix: str,
) -> None:
    for subscriber_id in set(subscriber_ids):
        create_notification(
            session,
            recipient_user_id=subscriber_id,
            actor_user_id=actor_user_id,
            notification_type=notification_type,
            entity_type=entity_type,
            entity_id=entity_id,
            title=title,
            body=body,
            dedupe_key=f"{dedupe_prefix}:{subscriber_id}",
        )


def notify_post_subscribers(session: Session, post: Post) -> None:
    if post.publication_status != "published" or post.status != "published":
        return
    filters = [
        and_(
            ContentSubscription.target_type == "board",
            ContentSubscription.target_id == post.board,
        )
    ]
    if post.tags:
        filters.append(
            and_(
                ContentSubscription.target_type == "tag",
                ContentSubscription.target_id.in_(post.tags),
            )
        )
    subscriber_ids = session.scalars(
        select(ContentSubscription.user_id).where(or_(*filters)).limit(5000)
    ).all()
    _notify_subscribers(
        session,
        subscriber_ids=subscriber_ids,
        actor_user_id=post.author_user_id,
        notification_type="subscription",
        entity_type="post",
        entity_id=str(post.id),
        title="你订阅的校园内容有更新",
        body=post.title or "有一张新的校园便笺发布了。",
        dedupe_prefix=f"subscription:post:{post.id}",
    )


def notify_club_subscribers(
    session: Session,
    *,
    club_id: str,
    actor_user_id: str | None,
    entity_type: str,
    entity_id: str,
    title: str,
    body: str,
    notification_type: str,
) -> None:
    subscriber_ids = session.scalars(
        select(ContentSubscription.user_id).where(
            or_(
                and_(
                    ContentSubscription.target_type == "club",
                    ContentSubscription.target_id == club_id,
                ),
                and_(
                    ContentSubscription.target_type == entity_type,
                    ContentSubscription.target_id == entity_id,
                ),
            )
        )
    ).all()
    _notify_subscribers(
        session,
        subscriber_ids=subscriber_ids,
        actor_user_id=actor_user_id,
        notification_type=notification_type,
        entity_type=entity_type,
        entity_id=entity_id,
        title=title,
        body=body,
        dedupe_prefix=f"subscription:{entity_type}:{entity_id}",
    )


def notify_club_managers(
    session: Session,
    *,
    club_id: str,
    actor_user_id: str,
    entity_type: str,
    entity_id: str,
    title: str,
    body: str,
) -> None:
    manager_ids = session.scalars(
        select(ClubMembership.user_id).where(
            ClubMembership.club_id == club_id,
            ClubMembership.status == "active",
            ClubMembership.role.in_(("owner", "manager")),
        )
    ).all()
    _notify_subscribers(
        session,
        subscriber_ids=manager_ids,
        actor_user_id=actor_user_id,
        notification_type="membership",
        entity_type=entity_type,
        entity_id=entity_id,
        title=title,
        body=body,
        dedupe_prefix=f"membership:{entity_type}:{entity_id}",
    )
