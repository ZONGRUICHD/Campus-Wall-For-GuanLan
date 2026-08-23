from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.auth_schemas import BootstrapAdminResult
from campus_wall_api.models import (
    AuditLog,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from campus_wall_api.security import hash_password, normalize_username

ROLE_DESCRIPTIONS = {
    "student": "已注册学生用户",
    "moderator": "内容审核与举报处置人员",
    "admin": "用户、内容与运营管理员",
    "super_admin": "系统最高管理员",
}

PERMISSION_DESCRIPTIONS = {
    "profile:manage": "管理自己的资料与隐私设置",
    "content:create": "创建校园内容",
    "content:interact": "评论、点赞、收藏与关注",
    "reports:create": "提交举报与申诉",
    "content:moderate": "审核、下架与恢复内容",
    "reports:manage": "处置举报与申诉",
    "users:read": "查看用户管理资料",
    "users:manage": "限制、封禁与恢复用户",
    "roles:assign": "分配或撤销管理员角色",
    "audit:read": "查看管理操作审计日志",
    "system:manage": "管理系统级安全与运营配置",
}

ROLE_PERMISSIONS = {
    "student": {
        "profile:manage",
        "content:create",
        "content:interact",
        "reports:create",
    },
    "moderator": {
        "profile:manage",
        "content:create",
        "content:interact",
        "reports:create",
        "content:moderate",
        "reports:manage",
    },
    "admin": {
        "profile:manage",
        "content:create",
        "content:interact",
        "reports:create",
        "content:moderate",
        "reports:manage",
        "users:read",
        "users:manage",
        "roles:assign",
        "audit:read",
    },
    "super_admin": set(PERMISSION_DESCRIPTIONS),
}

ASSIGNABLE_ADMIN_ROLES = {"moderator", "admin"}


class BootstrapConflictError(RuntimeError):
    pass


def audit_event(
    session: Session,
    *,
    action: str,
    target_type: str,
    target_id: str | None,
    actor_user_id: str | None = None,
    details: dict[str, object] | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details or {},
        )
    )


def seed_access_control(session_factory: sessionmaker[Session]) -> None:
    """Converge built-in roles and permissions without granting users new roles."""

    with session_factory() as session, session.begin():
        for name, description in ROLE_DESCRIPTIONS.items():
            role = session.get(Role, name)
            if role is None:
                session.add(Role(name=name, description=description, is_system=True))
            else:
                role.description = description
                role.is_system = True

        for code, description in PERMISSION_DESCRIPTIONS.items():
            permission = session.get(Permission, code)
            if permission is None:
                session.add(Permission(code=code, description=description))
            else:
                permission.description = description

        session.flush()
        existing_mappings = {
            (mapping.role_name, mapping.permission_code): mapping
            for mapping in session.scalars(select(RolePermission)).all()
        }
        desired_mappings = {
            (role_name, permission)
            for role_name, permissions in ROLE_PERMISSIONS.items()
            for permission in permissions
        }
        for key, mapping in existing_mappings.items():
            if key not in desired_mappings:
                session.delete(mapping)
        for role_name, permission_code in desired_mappings - set(existing_mappings):
            session.add(
                RolePermission(
                    role_name=role_name,
                    permission_code=permission_code,
                )
            )


def get_user_roles(session: Session, user_id: str) -> list[str]:
    return list(
        session.scalars(
            select(UserRole.role_name)
            .where(UserRole.user_id == user_id)
            .order_by(UserRole.role_name)
        ).all()
    )


def get_user_permissions(session: Session, user_id: str) -> list[str]:
    return list(
        session.scalars(
            select(RolePermission.permission_code)
            .join(UserRole, UserRole.role_name == RolePermission.role_name)
            .where(UserRole.user_id == user_id)
            .distinct()
            .order_by(RolePermission.permission_code)
        ).all()
    )


def user_has_any_role(session: Session, user_id: str, roles: Iterable[str]) -> bool:
    role_names = tuple(roles)
    if not role_names:
        return False
    return (
        session.scalar(
            select(UserRole.user_id).where(
                UserRole.user_id == user_id,
                UserRole.role_name.in_(role_names),
            )
        )
        is not None
    )


def bootstrap_super_admin(
    session_factory: sessionmaker[Session],
    *,
    username: str,
    password: str,
) -> BootstrapAdminResult:
    """Create the first super admin once; never reset an existing password."""

    normalized_username = normalize_username(username)
    with session_factory() as session, session.begin():
        existing = session.scalar(
            select(User).where(User.normalized_username == normalized_username)
        )
        if existing is not None:
            if not user_has_any_role(session, existing.id, {"super_admin"}):
                raise BootstrapConflictError(
                    "bootstrap username already exists without the super_admin role"
                )
            return BootstrapAdminResult(
                username=existing.username,
                created=False,
                must_change_password=existing.must_change_password,
            )

        user = User(
            username=username.strip(),
            normalized_username=normalized_username,
            display_name="系统管理员",
            password_hash=hash_password(password),
            must_change_password=True,
            campus_verified=True,
        )
        session.add(user)
        session.flush()
        session.add_all(
            [
                UserRole(user_id=user.id, role_name="student"),
                UserRole(user_id=user.id, role_name="super_admin"),
            ]
        )
        audit_event(
            session,
            action="identity.bootstrap_super_admin",
            target_type="user",
            target_id=user.id,
            details={"username": user.username},
        )
        return BootstrapAdminResult(
            username=user.username,
            created=True,
            must_change_password=True,
        )
