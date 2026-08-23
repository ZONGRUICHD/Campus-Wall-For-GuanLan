"""Create the initial Campus Wall schema.

This API did not exist in the repository before this revision, and there is no
pre-existing API database or business data to backfill. This revision therefore
creates the base schema only; it does not pretend to perform a legacy migration.

Revision ID: 20260824_0001
Revises: None
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "posts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("board", sa.String(length=32), nullable=False),
        sa.Column("author_name", sa.String(length=50), nullable=False),
        sa.Column("anonymous", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("lost_found_kind", sa.String(length=16), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("resolved", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("seed_key", sa.String(length=100), nullable=True),
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
            "board IN ('news', 'daily', 'lost_found', 'confession', 'tree_hole')",
            name="ck_posts_board",
        ),
        sa.CheckConstraint(
            "lost_found_kind IS NULL OR lost_found_kind IN ('lost', 'found')",
            name="ck_posts_lost_found_kind",
        ),
        sa.CheckConstraint(
            "(board = 'lost_found' AND lost_found_kind IS NOT NULL) OR "
            "(board <> 'lost_found' AND lost_found_kind IS NULL "
            "AND location IS NULL AND resolved = false)",
            name="ck_posts_lost_found_fields",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("seed_key", name="uq_posts_seed_key"),
    )
    op.create_index(
        "ix_posts_board_created_at_id",
        "posts",
        ["board", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_posts_lost_found_resolved",
        "posts",
        ["board", "resolved"],
        unique=False,
    )

    op.create_table(
        "comments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_name", sa.String(length=50), nullable=False),
        sa.Column("anonymous", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_comments_post_id_created_at",
        "comments",
        ["post_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "reactions",
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("actor", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("post_id", "actor"),
    )


def downgrade() -> None:
    op.drop_table("reactions")
    op.drop_index("ix_comments_post_id_created_at", table_name="comments")
    op.drop_table("comments")
    op.drop_index("ix_posts_lost_found_resolved", table_name="posts")
    op.drop_index("ix_posts_board_created_at_id", table_name="posts")
    op.drop_table("posts")
