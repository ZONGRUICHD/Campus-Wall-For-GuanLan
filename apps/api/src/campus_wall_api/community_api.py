import hashlib
import hmac
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import audit_event
from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.community_schemas import (
    CampusEventCreate,
    CampusEventList,
    CampusEventRead,
    CampusEventStatus,
    CampusEventUpdate,
    ClubAnnouncementCreate,
    ClubAnnouncementList,
    ClubAnnouncementRead,
    ClubCreate,
    ClubList,
    ClubMembershipApply,
    ClubMembershipList,
    ClubMembershipRead,
    ClubMembershipReview,
    ClubMembershipRole,
    ClubMembershipStatus,
    ClubRead,
    ClubUpdate,
    ClubVerificationUpdate,
    EventCheckIn,
    EventRegistrationList,
    EventRegistrationRead,
)
from campus_wall_api.database import session_dependency
from campus_wall_api.models import (
    CampusEvent,
    Club,
    ClubAnnouncement,
    ClubMembership,
    EventRegistration,
    User,
    utc_now,
)
from campus_wall_api.notification_service import (
    create_notification,
    notify_club_managers,
    notify_club_subscribers,
)


def _problem(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _membership(session: Session, club_id: str, user_id: str) -> ClubMembership | None:
    return session.get(ClubMembership, (club_id, user_id))


def _can_manage_club(
    session: Session,
    club: Club,
    identity: CurrentIdentity,
) -> bool:
    if "content:moderate" in identity.permissions:
        return True
    membership = _membership(session, club.id, identity.user.id)
    return bool(
        membership and membership.status == "active" and membership.role in {"owner", "manager"}
    )


def _get_club(session: Session, club_id: str) -> Club:
    club = session.get(Club, club_id)
    if club is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return club


def _get_event(session: Session, event_id: str) -> CampusEvent:
    event = session.get(CampusEvent, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return event


def _club_read(
    session: Session,
    club: Club,
    identity: CurrentIdentity,
) -> ClubRead:
    owner = session.get(User, club.owner_user_id) if club.owner_user_id else None
    membership = _membership(session, club.id, identity.user.id)
    member_count = session.scalar(
        select(func.count())
        .select_from(ClubMembership)
        .where(
            ClubMembership.club_id == club.id,
            ClubMembership.status == "active",
        )
    )
    return ClubRead(
        id=club.id,
        slug=club.slug,
        name=club.name,
        description=club.description,
        owner_user_id=club.owner_user_id,
        owner_name=owner.display_name if owner and owner.status != "deleted" else "已注销用户",
        status=club.status,
        recruitment_status=club.recruitment_status,
        member_limit=club.member_limit,
        member_count=int(member_count or 0),
        membership_role=membership.role if membership else None,
        membership_status=membership.status if membership else None,
        can_manage=_can_manage_club(session, club, identity),
        verification_note=(
            club.verification_note
            if _can_manage_club(session, club, identity)
            or "content:moderate" in identity.permissions
            else None
        ),
        created_at=club.created_at,
        updated_at=club.updated_at,
    )


def _membership_read(
    session: Session,
    membership: ClubMembership,
    identity: CurrentIdentity,
) -> ClubMembershipRead:
    user = session.get(User, membership.user_id)
    club = _get_club(session, membership.club_id)
    return ClubMembershipRead(
        club_id=membership.club_id,
        user_id=membership.user_id,
        user_name=user.display_name if user and user.status != "deleted" else "已注销用户",
        role=membership.role,
        status=membership.status,
        application_message=membership.application_message,
        can_review=_can_manage_club(session, club, identity) and membership.role != "owner",
        created_at=membership.created_at,
        updated_at=membership.updated_at,
    )


def _announcement_read(session: Session, item: ClubAnnouncement) -> ClubAnnouncementRead:
    author = session.get(User, item.author_user_id) if item.author_user_id else None
    return ClubAnnouncementRead(
        id=item.id,
        club_id=item.club_id,
        author_name=author.display_name if author and author.status != "deleted" else "社团管理员",
        title=item.title,
        body=item.body,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _event_read(
    session: Session,
    event: CampusEvent,
    identity: CurrentIdentity,
) -> CampusEventRead:
    club = _get_club(session, event.club_id)
    organizer = session.get(User, event.organizer_user_id) if event.organizer_user_id else None
    registration = session.get(EventRegistration, (event.id, identity.user.id))
    now = utc_now()
    registration_closes_at = event.registration_deadline or event.starts_at
    registration_open = (
        club.status == "verified"
        and event.status == "published"
        and now < registration_closes_at
        and now < event.starts_at
        and (event.capacity is None or event.registered_count < event.capacity)
    )
    check_in_configured = event.check_in_code_hash is not None
    check_in_open = (
        club.status == "verified"
        and event.status == "published"
        and check_in_configured
        and event.starts_at - timedelta(hours=2) <= now
        and now <= event.ends_at + timedelta(hours=2)
    )
    return CampusEventRead(
        id=event.id,
        club_id=club.id,
        club_name=club.name,
        organizer_user_id=event.organizer_user_id,
        organizer_name=(
            organizer.display_name if organizer and organizer.status != "deleted" else "社团管理员"
        ),
        title=event.title,
        description=event.description,
        location=event.location,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        registration_deadline=event.registration_deadline,
        capacity=event.capacity,
        registered_count=event.registered_count,
        status=event.status,
        registration_status=registration.status if registration else None,
        registration_open=registration_open,
        check_in_configured=check_in_configured,
        check_in_open=check_in_open,
        can_manage=_can_manage_club(session, club, identity),
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


def _registration_read(
    session: Session,
    registration: EventRegistration,
) -> EventRegistrationRead:
    user = session.get(User, registration.user_id)
    return EventRegistrationRead(
        event_id=registration.event_id,
        user_id=registration.user_id,
        user_name=user.display_name if user and user.status != "deleted" else "已注销用户",
        status=registration.status,
        registered_at=registration.registered_at,
        checked_in_at=registration.checked_in_at,
        updated_at=registration.updated_at,
    )


def _check_in_code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


def _validate_event_state(
    *,
    starts_at: datetime,
    ends_at: datetime,
    registration_deadline: datetime | None,
    capacity: int | None,
    registered_count: int,
    event_status: str,
    require_future_start: bool,
) -> None:
    starts_at = starts_at.astimezone(UTC)
    ends_at = ends_at.astimezone(UTC)
    if ends_at <= starts_at:
        raise _problem(422, "invalid_event_time", "event end time must be after its start time")
    if registration_deadline and registration_deadline.astimezone(UTC) > starts_at:
        raise _problem(
            422,
            "invalid_registration_deadline",
            "registration deadline must not be after the event starts",
        )
    if capacity is not None and capacity < registered_count:
        raise _problem(
            409,
            "capacity_below_registration_count",
            "capacity cannot be lower than the active registration count",
        )
    if require_future_start and event_status == "published" and starts_at <= utc_now():
        raise _problem(422, "event_start_in_past", "published events must start in the future")


def create_community_router(
    session_factory: sessionmaker[Session],
    identity_provider: IdentityProvider,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]
    CurrentIdentityDependency = Annotated[
        CurrentIdentity,
        Depends(identity_provider),
    ]

    @router.get("/clubs", response_model=ClubList)
    def list_clubs(
        session: SessionDependency,
        identity: CurrentIdentityDependency,
        query: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
        mine: bool = False,
        review_queue: bool = False,
    ) -> ClubList:
        with session.begin():
            statement = select(Club)
            if review_queue:
                if "content:moderate" not in identity.permissions:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
                statement = statement.where(Club.status != "verified")
            elif mine:
                statement = statement.join(
                    ClubMembership,
                    ClubMembership.club_id == Club.id,
                ).where(ClubMembership.user_id == identity.user.id)
            else:
                statement = statement.where(Club.status == "verified")
            if query:
                term = f"%{query.strip().casefold()}%"
                statement = statement.where(
                    or_(
                        func.lower(Club.name).like(term),
                        func.lower(Club.description).like(term),
                        func.lower(Club.slug).like(term),
                    )
                )
            clubs = session.scalars(statement.order_by(Club.updated_at.desc())).all()
            return ClubList(
                items=[_club_read(session, club, identity) for club in clubs],
                total=len(clubs),
            )

    @router.post(
        "/clubs",
        response_model=ClubRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_club(
        payload: ClubCreate,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubRead:
        if "content:create" not in identity.permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
        slug = payload.slug or f"club-{uuid4().hex[:12]}"
        try:
            with session.begin():
                club = Club(
                    slug=slug,
                    name=payload.name,
                    description=payload.description,
                    owner_user_id=identity.user.id,
                    recruitment_status=payload.recruitment_status.value,
                    member_limit=payload.member_limit,
                )
                session.add(club)
                session.flush()
                session.add(
                    ClubMembership(
                        club_id=club.id,
                        user_id=identity.user.id,
                        role="owner",
                        status="active",
                        reviewed_by_user_id=identity.user.id,
                        reviewed_at=utc_now(),
                    )
                )
                audit_event(
                    session,
                    action="community.club_submitted",
                    target_type="club",
                    target_id=club.id,
                    actor_user_id=identity.user.id,
                    details={"slug": club.slug},
                )
                session.flush()
                return _club_read(session, club, identity)
        except IntegrityError as exc:
            raise _problem(409, "club_slug_exists", "this club slug is already in use") from exc

    @router.get("/clubs/{club_id}", response_model=ClubRead)
    def get_club(
        club_id: str,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubRead:
        with session.begin():
            club = _get_club(session, club_id)
            if club.status != "verified" and not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            return _club_read(session, club, identity)

    @router.patch("/clubs/{club_id}", response_model=ClubRead)
    def update_club(
        club_id: str,
        payload: ClubUpdate,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubRead:
        with session.begin():
            club = _get_club(session, club_id)
            if not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            if club.status == "suspended" and "content:moderate" not in identity.permissions:
                raise _problem(409, "club_suspended", "suspended clubs cannot be edited")
            for field, value in payload.model_dump(exclude_unset=True).items():
                setattr(club, field, value.value if hasattr(value, "value") else value)
            club.updated_at = utc_now()
            audit_event(
                session,
                action="community.club_updated",
                target_type="club",
                target_id=club.id,
                actor_user_id=identity.user.id,
                details={"fields": sorted(payload.model_fields_set)},
            )
            session.flush()
            return _club_read(session, club, identity)

    @router.patch("/clubs/{club_id}/verification", response_model=ClubRead)
    def review_club(
        club_id: str,
        payload: ClubVerificationUpdate,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubRead:
        if "content:moderate" not in identity.permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
        with session.begin():
            club = _get_club(session, club_id)
            now = utc_now()
            club.status = payload.status.value
            club.verification_note = payload.note
            club.verified_by_user_id = identity.user.id
            club.verified_at = now if payload.status.value == "verified" else None
            club.updated_at = now
            if payload.status.value in {"rejected", "suspended"}:
                club.recruitment_status = "paused"
            audit_event(
                session,
                action=f"community.club_{payload.status.value}",
                target_type="club",
                target_id=club.id,
                actor_user_id=identity.user.id,
                details={"note": payload.note},
            )
            session.flush()
            return _club_read(session, club, identity)

    @router.post(
        "/clubs/{club_id}/memberships",
        response_model=ClubMembershipRead,
        status_code=status.HTTP_201_CREATED,
    )
    def apply_for_membership(
        club_id: str,
        payload: ClubMembershipApply,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubMembershipRead:
        with session.begin():
            club = _get_club(session, club_id)
            if club.status != "verified" or club.recruitment_status != "open":
                raise _problem(
                    409, "club_recruitment_closed", "this club is not accepting applications"
                )
            existing = _membership(session, club.id, identity.user.id)
            if existing and existing.status in {"pending", "active"}:
                raise _problem(
                    409,
                    "club_membership_exists",
                    "an active membership or application already exists",
                )
            if existing:
                existing.role = "member"
                existing.status = "pending"
                existing.application_message = payload.message
                existing.reviewed_by_user_id = None
                existing.reviewed_at = None
                existing.updated_at = utc_now()
                membership = existing
            else:
                membership = ClubMembership(
                    club_id=club.id,
                    user_id=identity.user.id,
                    role="member",
                    status="pending",
                    application_message=payload.message,
                )
                session.add(membership)
            audit_event(
                session,
                action="community.membership_applied",
                target_type="club",
                target_id=club.id,
                actor_user_id=identity.user.id,
            )
            notify_club_managers(
                session,
                club_id=club.id,
                actor_user_id=identity.user.id,
                entity_type="club_membership",
                entity_id=f"{club.id}:{identity.user.id}",
                title="社团收到新的入社申请",
                body=f"{identity.user.display_name} 申请加入 {club.name}。",
            )
            session.flush()
            return _membership_read(session, membership, identity)

    @router.get(
        "/clubs/{club_id}/memberships",
        response_model=ClubMembershipList,
    )
    def list_memberships(
        club_id: str,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubMembershipList:
        with session.begin():
            club = _get_club(session, club_id)
            if not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            memberships = session.scalars(
                select(ClubMembership)
                .where(ClubMembership.club_id == club.id)
                .order_by(ClubMembership.created_at.desc())
            ).all()
            return ClubMembershipList(
                items=[
                    _membership_read(session, membership, identity) for membership in memberships
                ],
                total=len(memberships),
            )

    @router.patch(
        "/clubs/{club_id}/memberships/{user_id}",
        response_model=ClubMembershipRead,
    )
    def review_membership(
        club_id: str,
        user_id: str,
        payload: ClubMembershipReview,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubMembershipRead:
        with session.begin():
            club = _get_club(session, club_id)
            reviewer = _membership(session, club.id, identity.user.id)
            if not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            membership = _membership(session, club.id, user_id)
            if membership is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if membership.role == "owner":
                raise _problem(
                    409, "club_owner_immutable", "club owner membership cannot be reviewed"
                )
            if (
                payload.role is ClubMembershipRole.MANAGER
                and "content:moderate" not in identity.permissions
                and (reviewer is None or reviewer.role != "owner")
            ):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            if payload.status is ClubMembershipStatus.ACTIVE:
                active_count = session.scalar(
                    select(func.count())
                    .select_from(ClubMembership)
                    .where(
                        ClubMembership.club_id == club.id,
                        ClubMembership.status == "active",
                    )
                )
                if (
                    club.member_limit is not None
                    and membership.status != "active"
                    and int(active_count or 0) >= club.member_limit
                ):
                    raise _problem(409, "club_member_limit_reached", "club member limit is reached")
            membership.status = payload.status.value
            membership.role = payload.role.value
            membership.reviewed_by_user_id = identity.user.id
            membership.reviewed_at = utc_now()
            membership.updated_at = utc_now()
            audit_event(
                session,
                action=f"community.membership_{payload.status.value}",
                target_type="club_membership",
                target_id=f"{club.id}:{membership.user_id}",
                actor_user_id=identity.user.id,
                details={"role": membership.role},
            )
            create_notification(
                session,
                recipient_user_id=membership.user_id,
                actor_user_id=identity.user.id,
                notification_type="membership",
                entity_type="club",
                entity_id=club.id,
                title="你的入社申请有新结果",
                body=(
                    f"你加入 {club.name} 的申请已通过。"
                    if payload.status is ClubMembershipStatus.ACTIVE
                    else f"你加入 {club.name} 的申请未通过。"
                ),
                dedupe_key=(
                    f"membership:review:{club.id}:{membership.user_id}:"
                    f"{payload.status.value}:{membership.updated_at.isoformat()}"
                ),
            )
            session.flush()
            return _membership_read(session, membership, identity)

    @router.delete(
        "/clubs/{club_id}/memberships/me",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def leave_club(
        club_id: str,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> Response:
        with session.begin():
            club = _get_club(session, club_id)
            membership = _membership(session, club.id, identity.user.id)
            if membership is None or membership.status not in {"pending", "active"}:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if membership.role == "owner":
                raise _problem(409, "club_owner_cannot_leave", "transfer ownership before leaving")
            membership.status = "left"
            membership.role = "member"
            membership.updated_at = utc_now()
            audit_event(
                session,
                action="community.membership_left",
                target_type="club",
                target_id=club.id,
                actor_user_id=identity.user.id,
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get(
        "/clubs/{club_id}/announcements",
        response_model=ClubAnnouncementList,
    )
    def list_announcements(
        club_id: str,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubAnnouncementList:
        with session.begin():
            club = _get_club(session, club_id)
            if club.status != "verified" and not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            items = session.scalars(
                select(ClubAnnouncement)
                .where(ClubAnnouncement.club_id == club.id)
                .order_by(ClubAnnouncement.created_at.desc())
                .limit(50)
            ).all()
            return ClubAnnouncementList(
                items=[_announcement_read(session, item) for item in items],
                total=len(items),
            )

    @router.post(
        "/clubs/{club_id}/announcements",
        response_model=ClubAnnouncementRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_announcement(
        club_id: str,
        payload: ClubAnnouncementCreate,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> ClubAnnouncementRead:
        with session.begin():
            club = _get_club(session, club_id)
            if not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            if club.status != "verified":
                raise _problem(
                    409, "club_not_verified", "only verified clubs can publish announcements"
                )
            item = ClubAnnouncement(
                club_id=club.id,
                author_user_id=identity.user.id,
                title=payload.title,
                body=payload.body,
            )
            session.add(item)
            session.flush()
            audit_event(
                session,
                action="community.announcement_created",
                target_type="club_announcement",
                target_id=item.id,
                actor_user_id=identity.user.id,
                details={"club_id": club.id},
            )
            notify_club_subscribers(
                session,
                club_id=club.id,
                actor_user_id=identity.user.id,
                entity_type="announcement",
                entity_id=item.id,
                title=f"{club.name} 发布了新公告",
                body=item.title,
                notification_type="announcement",
            )
            return _announcement_read(session, item)

    @router.get("/events", response_model=CampusEventList)
    def list_events(
        session: SessionDependency,
        identity: CurrentIdentityDependency,
        query: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
        club_id: str | None = None,
        mine: bool = False,
        upcoming: bool = True,
    ) -> CampusEventList:
        with session.begin():
            statement = select(CampusEvent).join(Club, Club.id == CampusEvent.club_id)
            if mine:
                statement = statement.join(
                    ClubMembership,
                    ClubMembership.club_id == Club.id,
                ).where(
                    ClubMembership.user_id == identity.user.id,
                    ClubMembership.status == "active",
                    ClubMembership.role.in_(("owner", "manager")),
                )
            else:
                statement = statement.where(
                    CampusEvent.status == "published",
                    Club.status == "verified",
                )
            if club_id:
                statement = statement.where(CampusEvent.club_id == club_id)
            if upcoming:
                statement = statement.where(CampusEvent.ends_at >= utc_now())
            if query:
                term = f"%{query.strip().casefold()}%"
                statement = statement.where(
                    or_(
                        func.lower(CampusEvent.title).like(term),
                        func.lower(CampusEvent.description).like(term),
                        func.lower(CampusEvent.location).like(term),
                        func.lower(Club.name).like(term),
                    )
                )
            events = session.scalars(
                statement.distinct().order_by(CampusEvent.starts_at.asc()).limit(100)
            ).all()
            return CampusEventList(
                items=[_event_read(session, event, identity) for event in events],
                total=len(events),
            )

    @router.post(
        "/clubs/{club_id}/events",
        response_model=CampusEventRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_event(
        club_id: str,
        payload: CampusEventCreate,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> CampusEventRead:
        with session.begin():
            club = _get_club(session, club_id)
            if not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            if club.status != "verified":
                raise _problem(409, "club_not_verified", "only verified clubs can publish events")
            event = CampusEvent(
                club_id=club.id,
                organizer_user_id=identity.user.id,
                title=payload.title,
                description=payload.description,
                location=payload.location,
                starts_at=payload.starts_at,
                ends_at=payload.ends_at,
                registration_deadline=payload.registration_deadline,
                capacity=payload.capacity,
                status=payload.status.value,
                check_in_code_hash=(
                    _check_in_code_hash(payload.check_in_code) if payload.check_in_code else None
                ),
            )
            session.add(event)
            session.flush()
            audit_event(
                session,
                action="community.event_created",
                target_type="campus_event",
                target_id=event.id,
                actor_user_id=identity.user.id,
                details={"club_id": club.id, "status": event.status},
            )
            if event.status == "published":
                notify_club_subscribers(
                    session,
                    club_id=club.id,
                    actor_user_id=identity.user.id,
                    entity_type="event",
                    entity_id=event.id,
                    title=f"{club.name} 发布了新活动",
                    body=event.title,
                    notification_type="event",
                )
            return _event_read(session, event, identity)

    @router.get("/events/{event_id}", response_model=CampusEventRead)
    def get_event(
        event_id: str,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> CampusEventRead:
        with session.begin():
            event = _get_event(session, event_id)
            club = _get_club(session, event.club_id)
            if (event.status != "published" or club.status != "verified") and not _can_manage_club(
                session, club, identity
            ):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            return _event_read(session, event, identity)

    @router.patch("/events/{event_id}", response_model=CampusEventRead)
    def update_event(
        event_id: str,
        payload: CampusEventUpdate,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> CampusEventRead:
        with session.begin():
            event = session.scalar(
                select(CampusEvent).where(CampusEvent.id == event_id).with_for_update()
            )
            if event is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            club = _get_club(session, event.club_id)
            if not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            changes = payload.model_dump(exclude_unset=True)
            previous_status = event.status
            requested_status = changes.get("status", event.status)
            requested_status = (
                requested_status.value
                if isinstance(requested_status, CampusEventStatus)
                else requested_status
            )
            allowed_transitions = {
                "draft": {"draft", "published", "cancelled"},
                "published": {"published", "cancelled", "completed"},
                "cancelled": {"cancelled"},
                "completed": {"completed"},
            }
            if requested_status not in allowed_transitions[previous_status]:
                raise _problem(
                    409, "invalid_event_transition", "event status transition is not allowed"
                )
            starts_at = changes.get("starts_at", event.starts_at)
            ends_at = changes.get("ends_at", event.ends_at)
            registration_deadline = changes.get(
                "registration_deadline", event.registration_deadline
            )
            capacity = changes.get("capacity", event.capacity)
            _validate_event_state(
                starts_at=starts_at,
                ends_at=ends_at,
                registration_deadline=registration_deadline,
                capacity=capacity,
                registered_count=event.registered_count,
                event_status=requested_status,
                require_future_start=(
                    previous_status != "published" or "starts_at" in payload.model_fields_set
                ),
            )
            if requested_status == "completed" and ends_at > utc_now():
                raise _problem(409, "event_not_finished", "an event cannot complete before it ends")
            check_in_code = changes.pop("check_in_code", None)
            if "check_in_code" in payload.model_fields_set:
                event.check_in_code_hash = (
                    _check_in_code_hash(check_in_code) if check_in_code else None
                )
            for field, value in changes.items():
                setattr(event, field, value.value if hasattr(value, "value") else value)
            if requested_status == "cancelled" and previous_status != "cancelled":
                registrations = session.scalars(
                    select(EventRegistration).where(
                        EventRegistration.event_id == event.id,
                        EventRegistration.status.in_(("registered", "checked_in")),
                    )
                ).all()
                now = utc_now()
                for registration in registrations:
                    registration.status = "cancelled"
                    registration.cancelled_at = now
                    registration.updated_at = now
                    create_notification(
                        session,
                        recipient_user_id=registration.user_id,
                        actor_user_id=identity.user.id,
                        notification_type="event",
                        entity_type="event",
                        entity_id=event.id,
                        title="你报名的活动已取消",
                        body=event.title,
                        dedupe_key=f"event:cancelled:{event.id}:{registration.user_id}",
                    )
                event.registered_count = 0
            event.updated_at = utc_now()
            audit_event(
                session,
                action=f"community.event_{requested_status}",
                target_type="campus_event",
                target_id=event.id,
                actor_user_id=identity.user.id,
                details={"fields": sorted(payload.model_fields_set)},
            )
            if previous_status != "published" and requested_status == "published":
                notify_club_subscribers(
                    session,
                    club_id=club.id,
                    actor_user_id=identity.user.id,
                    entity_type="event",
                    entity_id=event.id,
                    title=f"{club.name} 发布了新活动",
                    body=event.title,
                    notification_type="event",
                )
            session.flush()
            return _event_read(session, event, identity)

    @router.post(
        "/events/{event_id}/registrations",
        response_model=EventRegistrationRead,
        status_code=status.HTTP_201_CREATED,
    )
    def register_for_event(
        event_id: str,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> EventRegistrationRead:
        try:
            with session.begin():
                event = session.scalar(
                    select(CampusEvent).where(CampusEvent.id == event_id).with_for_update()
                )
                if event is None:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
                club = _get_club(session, event.club_id)
                now = utc_now()
                deadline = event.registration_deadline or event.starts_at
                if (
                    event.status != "published"
                    or club.status != "verified"
                    or now >= deadline
                    or now >= event.starts_at
                ):
                    raise _problem(
                        409,
                        "event_registration_closed",
                        "registration is closed for this event",
                    )
                registration = session.get(
                    EventRegistration,
                    (event.id, identity.user.id),
                )
                if registration and registration.status in {"registered", "checked_in"}:
                    raise _problem(
                        409,
                        "event_registration_exists",
                        "you already have an active registration",
                    )
                if event.capacity is not None and event.registered_count >= event.capacity:
                    raise _problem(409, "event_full", "this event has reached capacity")
                if registration:
                    registration.status = "registered"
                    registration.registered_at = now
                    registration.cancelled_at = None
                    registration.checked_in_at = None
                    registration.updated_at = now
                else:
                    registration = EventRegistration(
                        event_id=event.id,
                        user_id=identity.user.id,
                    )
                    session.add(registration)
                event.registered_count += 1
                event.updated_at = now
                audit_event(
                    session,
                    action="community.event_registered",
                    target_type="campus_event",
                    target_id=event.id,
                    actor_user_id=identity.user.id,
                )
                session.flush()
                return _registration_read(session, registration)
        except IntegrityError as exc:
            raise _problem(
                409,
                "event_registration_conflict",
                "registration changed concurrently; refresh and try again",
            ) from exc

    @router.delete(
        "/events/{event_id}/registrations/me",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def cancel_event_registration(
        event_id: str,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> Response:
        with session.begin():
            event = session.scalar(
                select(CampusEvent).where(CampusEvent.id == event_id).with_for_update()
            )
            if event is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            registration = session.get(EventRegistration, (event.id, identity.user.id))
            if registration is None or registration.status != "registered":
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            now = utc_now()
            registration.status = "cancelled"
            registration.cancelled_at = now
            registration.updated_at = now
            event.registered_count = max(0, event.registered_count - 1)
            event.updated_at = now
            audit_event(
                session,
                action="community.event_registration_cancelled",
                target_type="campus_event",
                target_id=event.id,
                actor_user_id=identity.user.id,
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get(
        "/events/{event_id}/registrations",
        response_model=EventRegistrationList,
    )
    def list_event_registrations(
        event_id: str,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> EventRegistrationList:
        with session.begin():
            event = _get_event(session, event_id)
            club = _get_club(session, event.club_id)
            if not _can_manage_club(session, club, identity):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            registrations = session.scalars(
                select(EventRegistration)
                .where(EventRegistration.event_id == event.id)
                .order_by(EventRegistration.registered_at.asc())
            ).all()
            return EventRegistrationList(
                items=[_registration_read(session, registration) for registration in registrations],
                total=len(registrations),
            )

    @router.post(
        "/events/{event_id}/check-in",
        response_model=EventRegistrationRead,
    )
    def check_in_to_event(
        event_id: str,
        payload: EventCheckIn,
        session: SessionDependency,
        identity: CurrentIdentityDependency,
    ) -> EventRegistrationRead:
        with session.begin():
            event = _get_event(session, event_id)
            registration = session.get(EventRegistration, (event.id, identity.user.id))
            if registration is None or registration.status != "registered":
                raise _problem(
                    409, "event_registration_required", "active registration is required"
                )
            now = utc_now()
            if now < event.starts_at - timedelta(hours=2) or now > event.ends_at + timedelta(
                hours=2
            ):
                raise _problem(409, "event_check_in_closed", "event check-in is not currently open")
            if event.check_in_code_hash is None or not hmac.compare_digest(
                event.check_in_code_hash,
                _check_in_code_hash(payload.code),
            ):
                raise _problem(403, "invalid_check_in_code", "check-in code is invalid")
            registration.status = "checked_in"
            registration.checked_in_at = now
            registration.updated_at = now
            audit_event(
                session,
                action="community.event_checked_in",
                target_type="campus_event",
                target_id=event.id,
                actor_user_id=identity.user.id,
            )
            session.flush()
            return _registration_read(session, registration)

    return router
