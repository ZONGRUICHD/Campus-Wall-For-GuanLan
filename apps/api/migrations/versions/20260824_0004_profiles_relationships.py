"""Add profiles, privacy, sessions, relationships, and campus verification.

Revision ID: 20260824_0004
Revises: 20260824_0003
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0004"
down_revision: str | None = "20260824_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("bio", sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column("avatar_url", sa.String(length=500), nullable=True))
        batch_op.add_column(
            sa.Column(
                "level",
                sa.Integer(),
                server_default=sa.text("1"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "reputation",
                sa.Integer(),
                server_default=sa.text("100"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "profile_visibility",
                sa.String(length=20),
                server_default=sa.text("'campus'"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "show_activity",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "allow_direct_messages",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            )
        )
        batch_op.create_check_constraint(
            "ck_users_profile_visibility",
            "profile_visibility IN ('campus', 'private')",
        )

    with op.batch_alter_table("auth_sessions") as batch_op:
        batch_op.add_column(sa.Column("user_agent", sa.String(length=300), nullable=True))
        batch_op.add_column(sa.Column("ip_hash", sa.String(length=64), nullable=True))

    op.create_table(
        "user_follows",
        sa.Column("follower_id", sa.String(length=36), nullable=False),
        sa.Column("followed_id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "follower_id <> followed_id",
            name="ck_user_follows_distinct",
        ),
        sa.ForeignKeyConstraint(
            ["followed_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["follower_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("follower_id", "followed_id"),
    )
    op.create_index(
        "ix_user_follows_followed_created_at",
        "user_follows",
        ["followed_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "user_blocks",
        sa.Column("blocker_id", sa.String(length=36), nullable=False),
        sa.Column("blocked_id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "blocker_id <> blocked_id",
            name="ck_user_blocks_distinct",
        ),
        sa.ForeignKeyConstraint(
            ["blocked_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["blocker_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("blocker_id", "blocked_id"),
    )

    op.create_table(
        "campus_verifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("school_name", sa.String(length=200), nullable=False),
        sa.Column(
            "student_identifier_hash",
            sa.String(length=64),
            nullable=False,
        ),
        sa.Column("proof_object_key", sa.String(length=500), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("review_note", sa.String(length=1000), nullable=True),
        sa.Column("reviewed_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
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
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_campus_verifications_status",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("student_identifier_hash"),
    )
    op.create_index(
        "ix_campus_verifications_status_created_at",
        "campus_verifications",
        ["status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_campus_verifications_status_created_at",
        table_name="campus_verifications",
    )
    op.drop_table("campus_verifications")
    op.drop_table("user_blocks")
    op.drop_index(
        "ix_user_follows_followed_created_at",
        table_name="user_follows",
    )
    op.drop_table("user_follows")

    with op.batch_alter_table("auth_sessions") as batch_op:
        batch_op.drop_column("ip_hash")
        batch_op.drop_column("user_agent")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint(
            "ck_users_profile_visibility",
            type_="check",
        )
        batch_op.drop_column("allow_direct_messages")
        batch_op.drop_column("show_activity")
        batch_op.drop_column("profile_visibility")
        batch_op.drop_column("reputation")
        batch_op.drop_column("level")
        batch_op.drop_column("avatar_url")
        batch_op.drop_column("bio")
