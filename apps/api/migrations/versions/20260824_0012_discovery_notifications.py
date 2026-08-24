"""Add notifications, durable outbox, subscriptions, and search history.

Revision ID: 20260824_0012
Revises: 20260824_0011
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0012"
down_revision: str | None = "20260824_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("recipient_user_id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body", sa.String(length=500), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("dedupe_key", sa.String(length=240), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "type IN "
            "('comment', 'reply', 'reaction', 'follow', 'membership', "
            "'announcement', 'event', 'subscription', 'moderation', 'system')",
            name="ck_notifications_type",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["recipient_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key"),
    )
    op.create_index(
        "ix_notifications_recipient_created_at",
        "notifications",
        ["recipient_user_id", "created_at", "id"],
    )
    op.create_index(
        "ix_notifications_recipient_read_at",
        "notifications",
        ["recipient_user_id", "read_at"],
    )

    op.create_table(
        "notification_outbox",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("aggregate_type", sa.String(length=50), nullable=False),
        sa.Column("aggregate_id", sa.String(length=100), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("dedupe_key", sa.String(length=240), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "attempts",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "available_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
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
        sa.CheckConstraint("attempts >= 0", name="ck_notification_outbox_attempts"),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_notification_outbox_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key"),
    )
    op.create_index(
        "ix_notification_outbox_status_available_at",
        "notification_outbox",
        ["status", "available_at", "created_at"],
    )

    op.create_table(
        "content_subscriptions",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "target_type IN ('board', 'tag', 'club', 'event')",
            name="ck_content_subscriptions_target_type",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "target_type", "target_id"),
    )
    op.create_index(
        "ix_content_subscriptions_target_created_at",
        "content_subscriptions",
        ["target_type", "target_id", "created_at"],
    )

    op.create_table(
        "search_history",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("query", sa.String(length=100), nullable=False),
        sa.Column("normalized_query", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "normalized_query",
            name="uq_search_history_user_query",
        ),
    )
    op.create_index(
        "ix_search_history_user_created_at",
        "search_history",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_search_history_user_created_at", table_name="search_history")
    op.drop_table("search_history")
    op.drop_index(
        "ix_content_subscriptions_target_created_at",
        table_name="content_subscriptions",
    )
    op.drop_table("content_subscriptions")
    op.drop_index(
        "ix_notification_outbox_status_available_at",
        table_name="notification_outbox",
    )
    op.drop_table("notification_outbox")
    op.drop_index(
        "ix_notifications_recipient_read_at",
        table_name="notifications",
    )
    op.drop_index(
        "ix_notifications_recipient_created_at",
        table_name="notifications",
    )
    op.drop_table("notifications")
