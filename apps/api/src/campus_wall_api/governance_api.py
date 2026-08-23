from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import audit_event, user_has_any_role
from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.database import session_dependency
from campus_wall_api.governance_schemas import (
    AppealCreate,
    AppealList,
    AppealRead,
    AppealReview,
    AppealStatus,
    AuditLogList,
    AuditLogRead,
    ModerationResult,
    ModerationUpdate,
    ReportCreate,
    ReportList,
    ReportRead,
    ReportReview,
    ReportStatus,
    UserStatusUpdate,
)
from campus_wall_api.models import (
    Appeal,
    AuditLog,
    AuthSession,
    Comment,
    Post,
    Report,
    User,
    utc_now,
)

OPEN_REPORT_STATUSES = {"submitted", "in_review"}
OPEN_APPEAL_STATUSES = {"submitted", "in_review"}


def _require_ready(identity: CurrentIdentity) -> None:
    if identity.user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "password_change_required"},
        )


def _require_permission(identity: CurrentIdentity, permission: str) -> None:
    _require_ready(identity)
    if permission not in identity.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "permission denied"},
        )


def _report_read(report: Report) -> ReportRead:
    return ReportRead(
        id=report.id,
        reporter_user_id=report.reporter_user_id,
        target_type=report.target_type,
        target_id=report.target_id,
        category=report.category,
        description=report.description,
        emergency=report.emergency,
        priority=report.priority,
        status=report.status,
        assigned_to_user_id=report.assigned_to_user_id,
        resolution=report.resolution,
        created_at=report.created_at,
        updated_at=report.updated_at,
        resolved_at=report.resolved_at,
    )


def _appeal_read(appeal: Appeal) -> AppealRead:
    return AppealRead(
        id=appeal.id,
        appellant_user_id=appeal.appellant_user_id,
        target_type=appeal.target_type,
        target_id=appeal.target_id,
        reason=appeal.reason,
        status=appeal.status,
        reviewed_by_user_id=appeal.reviewed_by_user_id,
        resolution=appeal.resolution,
        created_at=appeal.created_at,
        updated_at=appeal.updated_at,
        resolved_at=appeal.resolved_at,
    )


def _target_exists(
    session: Session,
    target_type: str,
    target_id: str,
) -> bool:
    if target_type == "user":
        return session.get(User, target_id) is not None
    try:
        integer_id = int(target_id)
    except ValueError:
        return False
    if target_type == "post":
        post = session.get(Post, integer_id)
        return (
            post is not None
            and post.status == "published"
            and post.publication_status == "published"
        )
    if target_type == "comment":
        comment = session.get(Comment, integer_id)
        return comment is not None and comment.status == "published"
    if target_type == "report":
        return session.get(Report, target_id) is not None
    return False


def _user_owns_target(
    session: Session,
    *,
    user_id: str,
    target_type: str,
    target_id: str,
) -> bool:
    if target_type == "user":
        user = session.get(User, target_id)
        return target_id == user_id and user is not None and user.status == "suspended"
    if target_type == "report":
        report = session.get(Report, target_id)
        return (
            report is not None
            and report.reporter_user_id == user_id
            and report.status in {"resolved", "rejected"}
        )
    try:
        integer_id = int(target_id)
    except ValueError:
        return False
    if target_type == "post":
        post = session.get(Post, integer_id)
        return (
            post is not None
            and post.author_user_id == user_id
            and post.status in {"hidden", "deleted"}
        )
    if target_type == "comment":
        comment = session.get(Comment, integer_id)
        return (
            comment is not None
            and comment.author_user_id == user_id
            and comment.status in {"hidden", "deleted"}
        )
    return False


def _moderate_content(
    session: Session,
    *,
    target_type: str,
    target_id: str,
    next_status: str,
    reason: str | None,
    moderator_user_id: str,
) -> ModerationResult:
    try:
        integer_id = int(target_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="content not found",
        ) from exc
    target: Post | Comment | None
    if target_type == "post":
        target = session.get(Post, integer_id)
    elif target_type == "comment":
        target = session.get(Comment, integer_id)
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="only posts and comments can be moderated",
        )
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="content not found",
        )
    now = utc_now()
    target.status = next_status
    target.moderation_reason = reason
    target.moderated_by_user_id = moderator_user_id
    target.moderated_at = now
    if isinstance(target, Post):
        target.updated_at = now
    else:
        cascade_reason = f"parent comment {target.id} was hidden"
        parent_ids = [target.id]
        descendants: list[Comment] = []
        for _ in range(2):
            if not parent_ids:
                break
            children = session.scalars(
                select(Comment).where(Comment.parent_id.in_(parent_ids))
            ).all()
            descendants.extend(children)
            parent_ids = [child.id for child in children]
        for descendant in descendants:
            if next_status == "hidden" and descendant.status == "published":
                descendant.status = "hidden"
                descendant.moderation_reason = cascade_reason
                descendant.moderated_by_user_id = moderator_user_id
                descendant.moderated_at = now
            elif (
                next_status == "published"
                and descendant.status == "hidden"
                and descendant.moderation_reason == cascade_reason
            ):
                descendant.status = "published"
                descendant.moderation_reason = None
                descendant.moderated_by_user_id = moderator_user_id
                descendant.moderated_at = now
    audit_event(
        session,
        action=f"moderation.content_{next_status}",
        target_type=target_type,
        target_id=target_id,
        actor_user_id=moderator_user_id,
        details={"reason": reason},
    )
    return ModerationResult(
        target_type=target_type,
        target_id=target_id,
        status=next_status,
        reason=reason,
    )


def create_governance_router(
    session_factory: sessionmaker[Session],
    identity_provider: IdentityProvider,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]
    IdentityDependency = Annotated[CurrentIdentity, Depends(identity_provider)]

    @router.post(
        "/reports",
        response_model=ReportRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_report(
        payload: ReportCreate,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> ReportRead:
        _require_permission(identity, "reports:create")
        for object_key in payload.evidence_object_keys:
            if not object_key.startswith(f"reports/{identity.user.id}/"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="evidence object does not belong to the reporter",
                )
        with session.begin():
            if not _target_exists(
                session,
                payload.target_type.value,
                payload.target_id,
            ):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="report target not found",
                )
            duplicate = session.scalar(
                select(Report.id).where(
                    Report.reporter_user_id == identity.user.id,
                    Report.target_type == payload.target_type.value,
                    Report.target_id == payload.target_id,
                    Report.status.in_(OPEN_REPORT_STATUSES),
                )
            )
            if duplicate is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="an open report already exists for this target",
                )
            priority = 100 if payload.emergency else 50
            if payload.category.value in {"violence", "illegal"}:
                priority = max(priority, 90)
            elif payload.category.value in {"harassment", "privacy"}:
                priority = max(priority, 75)
            report = Report(
                reporter_user_id=identity.user.id,
                target_type=payload.target_type.value,
                target_id=payload.target_id,
                category=payload.category.value,
                description=payload.description,
                emergency=payload.emergency,
                priority=priority,
                evidence_object_keys=payload.evidence_object_keys,
            )
            session.add(report)
            session.flush()
            audit_event(
                session,
                action="report.submitted",
                target_type="report",
                target_id=report.id,
                actor_user_id=identity.user.id,
                details={
                    "target_type": report.target_type,
                    "target_id": report.target_id,
                    "emergency": report.emergency,
                    "priority": report.priority,
                },
            )
            return _report_read(report)

    @router.get("/reports/me", response_model=ReportList)
    def list_my_reports(
        identity: IdentityDependency,
        session: SessionDependency,
        offset: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ) -> ReportList:
        _require_permission(identity, "reports:create")
        with session.begin():
            filters = Report.reporter_user_id == identity.user.id
            items = session.scalars(
                select(Report)
                .where(filters)
                .order_by(Report.created_at.desc())
                .offset(offset)
                .limit(limit)
            ).all()
            total = int(session.scalar(select(func.count(Report.id)).where(filters)) or 0)
            return ReportList(
                items=[_report_read(item) for item in items],
                total=total,
            )

    @router.get("/admin/reports", response_model=ReportList)
    def list_reports(
        identity: IdentityDependency,
        session: SessionDependency,
        report_status: Annotated[
            str,
            Query(
                alias="status",
                pattern="^(submitted|in_review|resolved|rejected)$",
            ),
        ] = "submitted",
        offset: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ) -> ReportList:
        _require_permission(identity, "reports:manage")
        with session.begin():
            filters = Report.status == report_status
            items = session.scalars(
                select(Report)
                .where(filters)
                .order_by(Report.priority.desc(), Report.created_at.asc())
                .offset(offset)
                .limit(limit)
            ).all()
            total = int(session.scalar(select(func.count(Report.id)).where(filters)) or 0)
            return ReportList(
                items=[_report_read(item) for item in items],
                total=total,
            )

    @router.patch("/admin/reports/{report_id}", response_model=ReportRead)
    def review_report(
        report_id: str,
        payload: ReportReview,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> ReportRead:
        _require_permission(identity, "reports:manage")
        with session.begin():
            report = session.scalar(select(Report).where(Report.id == report_id).with_for_update())
            if report is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if report.status in {"resolved", "rejected"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="report was already finalized",
                )
            now = utc_now()
            report.status = payload.status.value
            report.resolution = payload.resolution
            if payload.assign_to_me:
                report.assigned_to_user_id = identity.user.id
            report.updated_at = now
            if payload.status in {ReportStatus.RESOLVED, ReportStatus.REJECTED}:
                report.resolved_at = now
            if payload.hide_target:
                _moderate_content(
                    session,
                    target_type=report.target_type,
                    target_id=report.target_id,
                    next_status="hidden",
                    reason=payload.resolution,
                    moderator_user_id=identity.user.id,
                )
            audit_event(
                session,
                action=f"report.{payload.status.value}",
                target_type="report",
                target_id=report.id,
                actor_user_id=identity.user.id,
                details={"hide_target": payload.hide_target},
            )
            session.flush()
            return _report_read(report)

    @router.patch(
        "/admin/moderation/{target_type}/{target_id}",
        response_model=ModerationResult,
    )
    def moderate_content(
        target_type: str,
        target_id: str,
        payload: ModerationUpdate,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> ModerationResult:
        _require_permission(identity, "content:moderate")
        with session.begin():
            result = _moderate_content(
                session,
                target_type=target_type,
                target_id=target_id,
                next_status=payload.status.value,
                reason=payload.reason,
                moderator_user_id=identity.user.id,
            )
            session.flush()
            return result

    @router.post(
        "/appeals",
        response_model=AppealRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_appeal(
        payload: AppealCreate,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> AppealRead:
        _require_ready(identity)
        with session.begin():
            if not _user_owns_target(
                session,
                user_id=identity.user.id,
                target_type=payload.target_type.value,
                target_id=payload.target_id,
            ):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="appeal target not found",
                )
            duplicate = session.scalar(
                select(Appeal.id).where(
                    Appeal.appellant_user_id == identity.user.id,
                    Appeal.target_type == payload.target_type.value,
                    Appeal.target_id == payload.target_id,
                    Appeal.status.in_(OPEN_APPEAL_STATUSES),
                )
            )
            if duplicate is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="an open appeal already exists for this target",
                )
            appeal = Appeal(
                appellant_user_id=identity.user.id,
                target_type=payload.target_type.value,
                target_id=payload.target_id,
                reason=payload.reason,
            )
            session.add(appeal)
            session.flush()
            audit_event(
                session,
                action="appeal.submitted",
                target_type="appeal",
                target_id=appeal.id,
                actor_user_id=identity.user.id,
                details={
                    "target_type": appeal.target_type,
                    "target_id": appeal.target_id,
                },
            )
            return _appeal_read(appeal)

    @router.get("/appeals/me", response_model=AppealList)
    def list_my_appeals(
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> AppealList:
        _require_ready(identity)
        with session.begin():
            filters = Appeal.appellant_user_id == identity.user.id
            items = session.scalars(
                select(Appeal).where(filters).order_by(Appeal.created_at.desc()).limit(100)
            ).all()
            total = int(session.scalar(select(func.count(Appeal.id)).where(filters)) or 0)
            return AppealList(
                items=[_appeal_read(item) for item in items],
                total=total,
            )

    @router.get("/admin/appeals", response_model=AppealList)
    def list_appeals(
        identity: IdentityDependency,
        session: SessionDependency,
        appeal_status: Annotated[
            str,
            Query(
                alias="status",
                pattern="^(submitted|in_review|approved|rejected)$",
            ),
        ] = "submitted",
    ) -> AppealList:
        _require_permission(identity, "reports:manage")
        with session.begin():
            filters = Appeal.status == appeal_status
            items = session.scalars(
                select(Appeal).where(filters).order_by(Appeal.created_at.asc()).limit(100)
            ).all()
            total = int(session.scalar(select(func.count(Appeal.id)).where(filters)) or 0)
            return AppealList(
                items=[_appeal_read(item) for item in items],
                total=total,
            )

    @router.patch("/admin/appeals/{appeal_id}", response_model=AppealRead)
    def review_appeal(
        appeal_id: str,
        payload: AppealReview,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> AppealRead:
        _require_permission(identity, "reports:manage")
        with session.begin():
            appeal = session.scalar(select(Appeal).where(Appeal.id == appeal_id).with_for_update())
            if appeal is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if appeal.status in {"approved", "rejected"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="appeal was already finalized",
                )
            now = utc_now()
            appeal.status = payload.status.value
            appeal.resolution = payload.resolution
            appeal.reviewed_by_user_id = identity.user.id
            appeal.updated_at = now
            if payload.status in {AppealStatus.APPROVED, AppealStatus.REJECTED}:
                appeal.resolved_at = now
            if payload.status is AppealStatus.APPROVED and appeal.target_type in {
                "post",
                "comment",
            }:
                _moderate_content(
                    session,
                    target_type=appeal.target_type,
                    target_id=appeal.target_id,
                    next_status="published",
                    reason=f"appeal {appeal.id} approved",
                    moderator_user_id=identity.user.id,
                )
            audit_event(
                session,
                action=f"appeal.{payload.status.value}",
                target_type="appeal",
                target_id=appeal.id,
                actor_user_id=identity.user.id,
            )
            session.flush()
            return _appeal_read(appeal)

    @router.get("/admin/audit-logs", response_model=AuditLogList)
    def list_audit_logs(
        identity: IdentityDependency,
        session: SessionDependency,
        action: Annotated[str | None, Query(max_length=100)] = None,
        actor_user_id: Annotated[str | None, Query(max_length=36)] = None,
        offset: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=200)] = 100,
    ) -> AuditLogList:
        _require_permission(identity, "audit:read")
        with session.begin():
            filters = []
            if action:
                filters.append(AuditLog.action == action)
            if actor_user_id:
                filters.append(AuditLog.actor_user_id == actor_user_id)
            items = session.scalars(
                select(AuditLog)
                .where(*filters)
                .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                .offset(offset)
                .limit(limit)
            ).all()
            total = int(session.scalar(select(func.count(AuditLog.id)).where(*filters)) or 0)
            return AuditLogList(
                items=[
                    AuditLogRead(
                        id=item.id,
                        actor_user_id=item.actor_user_id,
                        action=item.action,
                        target_type=item.target_type,
                        target_id=item.target_id,
                        details=item.details,
                        created_at=item.created_at,
                    )
                    for item in items
                ],
                total=total,
            )

    @router.patch("/admin/users/{user_id}/status")
    def update_user_status(
        user_id: str,
        payload: UserStatusUpdate,
        identity: IdentityDependency,
        session: SessionDependency,
    ) -> dict[str, str]:
        _require_permission(identity, "users:manage")
        if user_id == identity.user.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="administrators cannot change their own status",
            )
        with session.begin():
            user = session.get(User, user_id)
            if user is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if user_has_any_role(session, user.id, {"super_admin"}):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="a super admin cannot be suspended",
                )
            user.status = payload.status
            user.updated_at = utc_now()
            if payload.status == "suspended":
                for auth_session in session.scalars(
                    select(AuthSession).where(
                        AuthSession.user_id == user.id,
                        AuthSession.revoked_at.is_(None),
                    )
                ).all():
                    auth_session.revoked_at = utc_now()
            audit_event(
                session,
                action=f"user.{payload.status}",
                target_type="user",
                target_id=user.id,
                actor_user_id=identity.user.id,
                details={"reason": payload.reason},
            )
            return {"user_id": user.id, "status": user.status}

    return router
