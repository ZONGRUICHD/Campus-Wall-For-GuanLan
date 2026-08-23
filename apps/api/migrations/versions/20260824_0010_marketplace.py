"""Add second-hand marketplace listings and private inquiries.

Revision ID: 20260824_0010
Revises: 20260824_0009
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0010"
down_revision: str | None = "20260824_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("posts") as batch_op:
        batch_op.drop_constraint("ck_posts_board", type_="check")
        batch_op.create_check_constraint(
            "ck_posts_board",
            "board IN ('news', 'daily', 'lost_found', 'marketplace', 'confession', 'tree_hole')",
        )

    op.create_table(
        "marketplace_listings",
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("seller_user_id", sa.String(length=36), nullable=True),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("item_condition", sa.String(length=20), nullable=False),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column("original_price_cents", sa.Integer(), nullable=True),
        sa.Column(
            "negotiable",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column("trade_method", sa.String(length=32), nullable=False),
        sa.Column("meetup_location", sa.String(length=200), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'available'"),
            nullable=False,
        ),
        sa.Column(
            "review_status",
            sa.String(length=20),
            server_default=sa.text("'clear'"),
            nullable=False,
        ),
        sa.Column("review_reason", sa.String(length=1000), nullable=True),
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
            "category IN "
            "('books', 'electronics', 'daily_supplies', 'sports', "
            "'clothing', 'collectibles', 'other')",
            name="ck_marketplace_listings_category",
        ),
        sa.CheckConstraint(
            "item_condition IN ('new', 'like_new', 'good', 'fair')",
            name="ck_marketplace_listings_condition",
        ),
        sa.CheckConstraint(
            "trade_method IN ('campus_meetup', 'self_pickup')",
            name="ck_marketplace_listings_trade_method",
        ),
        sa.CheckConstraint(
            "status IN ('available', 'reserved', 'sold', 'withdrawn')",
            name="ck_marketplace_listings_status",
        ),
        sa.CheckConstraint(
            "review_status IN ('clear', 'blocked')",
            name="ck_marketplace_listings_review_status",
        ),
        sa.CheckConstraint(
            "price_cents >= 0 AND price_cents <= 10000000",
            name="ck_marketplace_listings_price",
        ),
        sa.CheckConstraint(
            "original_price_cents IS NULL OR "
            "(original_price_cents >= price_cents "
            "AND original_price_cents <= 10000000)",
            name="ck_marketplace_listings_original_price",
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["seller_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("post_id"),
    )
    op.create_index(
        "ix_marketplace_listings_category_status_price",
        "marketplace_listings",
        ["category", "status", "price_cents"],
        unique=False,
    )
    op.create_index(
        "ix_marketplace_listings_seller_updated_at",
        "marketplace_listings",
        ["seller_user_id", "updated_at"],
        unique=False,
    )

    op.create_table(
        "marketplace_inquiries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("buyer_user_id", sa.String(length=36), nullable=False),
        sa.Column("message", sa.String(length=1000), nullable=False),
        sa.Column(
            "anonymous",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
        sa.Column("seller_reply", sa.String(length=1000), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("replied_at", sa.DateTime(timezone=True), nullable=True),
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
            "status IN ('pending', 'replied', 'closed', 'cancelled')",
            name="ck_marketplace_inquiries_status",
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["buyer_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "post_id",
            "buyer_user_id",
            name="uq_marketplace_inquiries_post_buyer",
        ),
    )
    op.create_index(
        "ix_marketplace_inquiries_post_status_created_at",
        "marketplace_inquiries",
        ["post_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_marketplace_inquiries_buyer_created_at",
        "marketplace_inquiries",
        ["buyer_user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_marketplace_inquiries_buyer_created_at",
        table_name="marketplace_inquiries",
    )
    op.drop_index(
        "ix_marketplace_inquiries_post_status_created_at",
        table_name="marketplace_inquiries",
    )
    op.drop_table("marketplace_inquiries")
    op.drop_index(
        "ix_marketplace_listings_seller_updated_at",
        table_name="marketplace_listings",
    )
    op.drop_index(
        "ix_marketplace_listings_category_status_price",
        table_name="marketplace_listings",
    )
    op.drop_table("marketplace_listings")
    op.execute("DELETE FROM posts WHERE board = 'marketplace'")
    with op.batch_alter_table("posts") as batch_op:
        batch_op.drop_constraint("ck_posts_board", type_="check")
        batch_op.create_check_constraint(
            "ck_posts_board",
            "board IN ('news', 'daily', 'lost_found', 'confession', 'tree_hole')",
        )
