"""Add structured lost-and-found details and private claim workflow.

Revision ID: 20260824_0007
Revises: 20260824_0006
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0007"
down_revision: str | None = "20260824_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("posts") as batch_op:
        batch_op.add_column(
            sa.Column("lost_found_category", sa.String(length=32), nullable=True)
        )
        batch_op.add_column(
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True)
        )

    op.execute(
        "UPDATE posts "
        "SET lost_found_category = 'other', occurred_at = created_at "
        "WHERE board = 'lost_found'"
    )

    with op.batch_alter_table("posts") as batch_op:
        batch_op.drop_constraint("ck_posts_lost_found_fields", type_="check")
        batch_op.create_check_constraint(
            "ck_posts_lost_found_category",
            "lost_found_category IS NULL OR lost_found_category IN "
            "('documents', 'electronics', 'keys', 'clothing', 'books', 'other')",
        )
        batch_op.create_check_constraint(
            "ck_posts_lost_found_fields",
            "(board = 'lost_found' AND lost_found_kind IS NOT NULL "
            "AND lost_found_category IS NOT NULL AND occurred_at IS NOT NULL) OR "
            "(board <> 'lost_found' AND lost_found_kind IS NULL "
            "AND lost_found_category IS NULL AND occurred_at IS NULL "
            "AND location IS NULL AND resolved = false)",
        )
        batch_op.create_index(
            "ix_posts_lost_found_category_occurred_at",
            ["board", "lost_found_category", "occurred_at"],
            unique=False,
        )

    op.create_table(
        "lost_found_claims",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("claimant_user_id", sa.String(length=36), nullable=False),
        sa.Column("message", sa.String(length=1000), nullable=False),
        sa.Column("anonymous", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
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
            "status IN ('pending', 'accepted', 'rejected', 'cancelled')",
            name="ck_lost_found_claims_status",
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["claimant_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "post_id",
            "claimant_user_id",
            name="uq_lost_found_claims_post_claimant",
        ),
    )
    op.create_index(
        "ix_lost_found_claims_post_status_created_at",
        "lost_found_claims",
        ["post_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_lost_found_claims_claimant_created_at",
        "lost_found_claims",
        ["claimant_user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_lost_found_claims_claimant_created_at",
        table_name="lost_found_claims",
    )
    op.drop_index(
        "ix_lost_found_claims_post_status_created_at",
        table_name="lost_found_claims",
    )
    op.drop_table("lost_found_claims")

    with op.batch_alter_table("posts") as batch_op:
        batch_op.drop_index("ix_posts_lost_found_category_occurred_at")
        batch_op.drop_constraint("ck_posts_lost_found_fields", type_="check")
        batch_op.drop_constraint("ck_posts_lost_found_category", type_="check")
        batch_op.create_check_constraint(
            "ck_posts_lost_found_fields",
            "(board = 'lost_found' AND lost_found_kind IS NOT NULL) OR "
            "(board <> 'lost_found' AND lost_found_kind IS NULL "
            "AND location IS NULL AND resolved = false)",
        )
        batch_op.drop_column("occurred_at")
        batch_op.drop_column("lost_found_category")
