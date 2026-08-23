"""Add drafts, scheduling, bookmarks, and threaded comment interactions.

Revision ID: 20260824_0006
Revises: 20260824_0005
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0006"
down_revision: str | None = "20260824_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("posts") as batch_op:
        batch_op.add_column(
            sa.Column(
                "publication_status",
                sa.String(length=20),
                server_default=sa.text("'published'"),
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(
            sa.Column(
                "comments_enabled",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            )
        )
        batch_op.create_check_constraint(
            "ck_posts_publication_status",
            "publication_status IN ('draft', 'scheduled', 'published')",
        )
        batch_op.create_index(
            "ix_posts_publication_status_scheduled_for",
            ["publication_status", "scheduled_for"],
            unique=False,
        )

    op.execute(
        "UPDATE posts SET published_at = created_at "
        "WHERE publication_status = 'published' AND published_at IS NULL"
    )

    op.create_table(
        "post_bookmarks",
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("post_id", "user_id"),
    )
    op.create_index(
        "ix_post_bookmarks_user_created_at",
        "post_bookmarks",
        ["user_id", "created_at"],
        unique=False,
    )

    with op.batch_alter_table("comments") as batch_op:
        batch_op.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "depth",
                sa.Integer(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_check_constraint(
            "ck_comments_depth",
            "depth BETWEEN 0 AND 2",
        )
        batch_op.create_foreign_key(
            "fk_comments_parent_id_comments",
            "comments",
            ["parent_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index(
            "ix_comments_parent_id_created_at",
            ["parent_id", "created_at"],
            unique=False,
        )

    op.create_table(
        "comment_reactions",
        sa.Column("comment_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["comment_id"],
            ["comments.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("comment_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("comment_reactions")

    with op.batch_alter_table("comments") as batch_op:
        batch_op.drop_index("ix_comments_parent_id_created_at")
        batch_op.drop_constraint(
            "fk_comments_parent_id_comments",
            type_="foreignkey",
        )
        batch_op.drop_constraint("ck_comments_depth", type_="check")
        batch_op.drop_column("edited_at")
        batch_op.drop_column("depth")
        batch_op.drop_column("parent_id")

    op.drop_index(
        "ix_post_bookmarks_user_created_at",
        table_name="post_bookmarks",
    )
    op.drop_table("post_bookmarks")

    with op.batch_alter_table("posts") as batch_op:
        batch_op.drop_index("ix_posts_publication_status_scheduled_for")
        batch_op.drop_constraint(
            "ck_posts_publication_status",
            type_="check",
        )
        batch_op.drop_column("comments_enabled")
        batch_op.drop_column("edited_at")
        batch_op.drop_column("published_at")
        batch_op.drop_column("scheduled_for")
        batch_op.drop_column("publication_status")
