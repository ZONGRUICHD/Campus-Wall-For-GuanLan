"""Bind posts and comments to authenticated users.

Seeded and legacy MVP records remain nullable because no trustworthy user
identity existed when they were created.

Revision ID: 20260824_0003
Revises: 20260824_0002
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0003"
down_revision: str | None = "20260824_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("posts") as batch_op:
        batch_op.add_column(sa.Column("author_user_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_posts_author_user_id_users",
            "users",
            ["author_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_posts_author_user_id_created_at",
            ["author_user_id", "created_at"],
            unique=False,
        )

    with op.batch_alter_table("comments") as batch_op:
        batch_op.add_column(sa.Column("author_user_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_comments_author_user_id_users",
            "users",
            ["author_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_comments_author_user_id_created_at",
            ["author_user_id", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("comments") as batch_op:
        batch_op.drop_index("ix_comments_author_user_id_created_at")
        batch_op.drop_constraint(
            "fk_comments_author_user_id_users",
            type_="foreignkey",
        )
        batch_op.drop_column("author_user_id")

    with op.batch_alter_table("posts") as batch_op:
        batch_op.drop_index("ix_posts_author_user_id_created_at")
        batch_op.drop_constraint(
            "fk_posts_author_user_id_users",
            type_="foreignkey",
        )
        batch_op.drop_column("author_user_id")
