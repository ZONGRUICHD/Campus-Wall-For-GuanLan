"""Add content moderation, reporting, and appeals.

Revision ID: 20260824_0005
Revises: 20260824_0004
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0005"
down_revision: str | None = "20260824_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("posts") as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                sa.String(length=20),
                server_default=sa.text("'published'"),
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("moderation_reason", sa.String(length=1000), nullable=True))
        batch_op.add_column(sa.Column("moderated_by_user_id", sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_check_constraint(
            "ck_posts_status",
            "status IN ('pending', 'published', 'hidden', 'deleted')",
        )
        batch_op.create_foreign_key(
            "fk_posts_moderated_by_user_id_users",
            "users",
            ["moderated_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_posts_status_created_at",
            ["status", "created_at"],
            unique=False,
        )

    with op.batch_alter_table("comments") as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                sa.String(length=20),
                server_default=sa.text("'published'"),
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("moderation_reason", sa.String(length=1000), nullable=True))
        batch_op.add_column(sa.Column("moderated_by_user_id", sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_check_constraint(
            "ck_comments_status",
            "status IN ('pending', 'published', 'hidden', 'deleted')",
        )
        batch_op.create_foreign_key(
            "fk_comments_moderated_by_user_id_users",
            "users",
            ["moderated_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_comments_status_created_at",
            ["status", "created_at"],
            unique=False,
        )

    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("reporter_user_id", sa.String(length=36), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=False),
        sa.Column(
            "emergency",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column(
            "priority",
            sa.Integer(),
            server_default=sa.text("50"),
            nullable=False,
        ),
        sa.Column("evidence_object_keys", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'submitted'"),
            nullable=False,
        ),
        sa.Column("assigned_to_user_id", sa.String(length=36), nullable=True),
        sa.Column("resolution", sa.String(length=2000), nullable=True),
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
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "target_type IN ('post', 'comment', 'user')",
            name="ck_reports_target_type",
        ),
        sa.CheckConstraint(
            "category IN "
            "('harassment', 'privacy', 'misinformation', 'violence', "
            "'spam', 'illegal', 'other')",
            name="ck_reports_category",
        ),
        sa.CheckConstraint(
            "status IN ('submitted', 'in_review', 'resolved', 'rejected')",
            name="ck_reports_status",
        ),
        sa.ForeignKeyConstraint(
            ["assigned_to_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["reporter_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_reports_status_priority_created_at",
        "reports",
        ["status", "priority", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_reports_reporter_created_at",
        "reports",
        ["reporter_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_reports_target_created_at",
        "reports",
        ["target_type", "target_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "appeals",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("appellant_user_id", sa.String(length=36), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.String(length=100), nullable=False),
        sa.Column("reason", sa.String(length=2000), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'submitted'"),
            nullable=False,
        ),
        sa.Column("reviewed_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("resolution", sa.String(length=2000), nullable=True),
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
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "target_type IN ('post', 'comment', 'user', 'report')",
            name="ck_appeals_target_type",
        ),
        sa.CheckConstraint(
            "status IN ('submitted', 'in_review', 'approved', 'rejected')",
            name="ck_appeals_status",
        ),
        sa.ForeignKeyConstraint(
            ["appellant_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_appeals_status_created_at",
        "appeals",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_appeals_appellant_created_at",
        "appeals",
        ["appellant_user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_appeals_appellant_created_at", table_name="appeals")
    op.drop_index("ix_appeals_status_created_at", table_name="appeals")
    op.drop_table("appeals")
    op.drop_index("ix_reports_target_created_at", table_name="reports")
    op.drop_index("ix_reports_reporter_created_at", table_name="reports")
    op.drop_index("ix_reports_status_priority_created_at", table_name="reports")
    op.drop_table("reports")

    with op.batch_alter_table("comments") as batch_op:
        batch_op.drop_index("ix_comments_status_created_at")
        batch_op.drop_constraint(
            "fk_comments_moderated_by_user_id_users",
            type_="foreignkey",
        )
        batch_op.drop_constraint("ck_comments_status", type_="check")
        batch_op.drop_column("moderated_at")
        batch_op.drop_column("moderated_by_user_id")
        batch_op.drop_column("moderation_reason")
        batch_op.drop_column("status")

    with op.batch_alter_table("posts") as batch_op:
        batch_op.drop_index("ix_posts_status_created_at")
        batch_op.drop_constraint(
            "fk_posts_moderated_by_user_id_users",
            type_="foreignkey",
        )
        batch_op.drop_constraint("ck_posts_status", type_="check")
        batch_op.drop_column("moderated_at")
        batch_op.drop_column("moderated_by_user_id")
        batch_op.drop_column("moderation_reason")
        batch_op.drop_column("status")
