"""Add users, sessions, RBAC, and security audit logs.

Revision ID: 20260824_0002
Revises: 20260824_0001
Create Date: 2026-08-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260824_0002"
down_revision: str | None = "20260824_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("normalized_username", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("display_name", sa.String(length=50), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'active'"),
            nullable=False,
        ),
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column(
            "campus_verified",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column(
            "failed_login_attempts",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('active', 'suspended', 'deleted')",
            name="ck_users_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("normalized_username"),
    )
    op.create_index(
        "ix_users_status_created_at",
        "users",
        ["status", "created_at"],
        unique=False,
    )

    op.create_table(
        "roles",
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("description", sa.String(length=200), nullable=False),
        sa.Column(
            "is_system",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "name IN ('student', 'moderator', 'admin', 'super_admin')",
            name="ck_roles_name",
        ),
        sa.PrimaryKeyConstraint("name"),
    )

    op.create_table(
        "permissions",
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("code"),
    )

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("refresh_token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("refresh_token_hash"),
    )
    op.create_index(
        "ix_auth_sessions_user_id_expires_at",
        "auth_sessions",
        ["user_id", "expires_at"],
        unique=False,
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("target_type", sa.String(length=50), nullable=False),
        sa.Column("target_id", sa.String(length=100), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_audit_logs_actor_created_at",
        "audit_logs",
        ["actor_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_logs_target_created_at",
        "audit_logs",
        ["target_type", "target_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "role_permissions",
        sa.Column("role_name", sa.String(length=32), nullable=False),
        sa.Column("permission_code", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(
            ["permission_code"],
            ["permissions.code"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["role_name"], ["roles.name"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_name", "permission_code"),
    )

    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role_name", sa.String(length=32), nullable=False),
        sa.Column("granted_by_user_id", sa.String(length=36), nullable=True),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["granted_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["role_name"], ["roles.name"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "role_name"),
    )
    op.create_index(
        "ix_user_roles_role_name_user_id",
        "user_roles",
        ["role_name", "user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_roles_role_name_user_id", table_name="user_roles")
    op.drop_table("user_roles")
    op.drop_table("role_permissions")
    op.drop_index("ix_audit_logs_target_created_at", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor_created_at", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_auth_sessions_user_id_expires_at", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("permissions")
    op.drop_table("roles")
    op.drop_index("ix_users_status_created_at", table_name="users")
    op.drop_table("users")
