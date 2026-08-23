"""Add reusable image assets and ordered post attachments.

Revision ID: 20260824_0008
Revises: 20260824_0007
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0008"
down_revision: str | None = "20260824_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("object_key", sa.String(length=500), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=20), server_default="image", nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint("kind = 'image'", name="ck_media_assets_kind"),
        sa.CheckConstraint(
            "content_type IN ('image/jpeg', 'image/png', 'image/webp')",
            name="ck_media_assets_content_type",
        ),
        sa.CheckConstraint("byte_size > 0", name="ck_media_assets_byte_size"),
        sa.CheckConstraint(
            "status IN ('pending', 'ready', 'rejected', 'deleted')",
            name="ck_media_assets_status",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
    )
    op.create_index(
        "ix_media_assets_owner_status_created_at",
        "media_assets",
        ["owner_user_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_media_assets_expires_at",
        "media_assets",
        ["expires_at"],
        unique=False,
    )

    op.create_table(
        "post_media",
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("media_asset_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "position >= 0 AND position < 9",
            name="ck_post_media_position",
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["media_asset_id"],
            ["media_assets.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("post_id", "media_asset_id"),
        sa.UniqueConstraint(
            "post_id",
            "position",
            name="uq_post_media_post_position",
        ),
        sa.UniqueConstraint("media_asset_id", name="uq_post_media_asset"),
    )
    op.create_index(
        "ix_post_media_post_position",
        "post_media",
        ["post_id", "position"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_post_media_post_position", table_name="post_media")
    op.drop_table("post_media")
    op.drop_index("ix_media_assets_expires_at", table_name="media_assets")
    op.drop_index(
        "ix_media_assets_owner_status_created_at",
        table_name="media_assets",
    )
    op.drop_table("media_assets")
