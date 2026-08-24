"""Add verified clubs, memberships, announcements, events, and registrations.

Revision ID: 20260824_0011
Revises: 20260824_0010
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0011"
down_revision: str | None = "20260824_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "clubs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "recruitment_status",
            sa.String(length=20),
            server_default=sa.text("'closed'"),
            nullable=False,
        ),
        sa.Column("member_limit", sa.Integer(), nullable=True),
        sa.Column("verification_note", sa.String(length=1000), nullable=True),
        sa.Column("verified_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
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
            "status IN ('pending', 'verified', 'rejected', 'suspended')",
            name="ck_clubs_status",
        ),
        sa.CheckConstraint(
            "recruitment_status IN ('open', 'closed', 'paused')",
            name="ck_clubs_recruitment_status",
        ),
        sa.CheckConstraint(
            "member_limit IS NULL OR (member_limit >= 1 AND member_limit <= 5000)",
            name="ck_clubs_member_limit",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["verified_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_clubs_status_updated_at", "clubs", ["status", "updated_at"])
    op.create_index("ix_clubs_name", "clubs", ["name"])

    op.create_table(
        "club_memberships",
        sa.Column("club_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column(
            "role",
            sa.String(length=20),
            server_default=sa.text("'member'"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("application_message", sa.String(length=500), nullable=True),
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
            "role IN ('owner', 'manager', 'member')",
            name="ck_club_memberships_role",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'active', 'rejected', 'left')",
            name="ck_club_memberships_status",
        ),
        sa.ForeignKeyConstraint(["club_id"], ["clubs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("club_id", "user_id"),
    )
    op.create_index(
        "ix_club_memberships_club_status_created_at",
        "club_memberships",
        ["club_id", "status", "created_at"],
    )
    op.create_index(
        "ix_club_memberships_user_status_created_at",
        "club_memberships",
        ["user_id", "status", "created_at"],
    )

    op.create_table(
        "club_announcements",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("club_id", sa.String(length=36), nullable=False),
        sa.Column("author_user_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(["club_id"], ["clubs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["author_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_club_announcements_club_created_at",
        "club_announcements",
        ["club_id", "created_at"],
    )

    op.create_table(
        "campus_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("club_id", sa.String(length=36), nullable=False),
        sa.Column("organizer_user_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("location", sa.String(length=200), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("registration_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column(
            "registered_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'draft'"),
            nullable=False,
        ),
        sa.Column("check_in_code_hash", sa.String(length=64), nullable=True),
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
            "status IN ('draft', 'published', 'cancelled', 'completed')",
            name="ck_campus_events_status",
        ),
        sa.CheckConstraint("ends_at > starts_at", name="ck_campus_events_time_range"),
        sa.CheckConstraint(
            "registration_deadline IS NULL OR registration_deadline <= starts_at",
            name="ck_campus_events_registration_deadline",
        ),
        sa.CheckConstraint(
            "capacity IS NULL OR (capacity >= 1 AND capacity <= 10000)",
            name="ck_campus_events_capacity",
        ),
        sa.CheckConstraint(
            "registered_count >= 0 AND (capacity IS NULL OR registered_count <= capacity)",
            name="ck_campus_events_registered_count",
        ),
        sa.ForeignKeyConstraint(["club_id"], ["clubs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["organizer_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_campus_events_status_starts_at",
        "campus_events",
        ["status", "starts_at"],
    )
    op.create_index(
        "ix_campus_events_club_starts_at",
        "campus_events",
        ["club_id", "starts_at"],
    )

    op.create_table(
        "event_registrations",
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'registered'"),
            nullable=False,
        ),
        sa.Column(
            "registered_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('registered', 'cancelled', 'checked_in')",
            name="ck_event_registrations_status",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["campus_events.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "user_id"),
    )
    op.create_index(
        "ix_event_registrations_event_status_registered_at",
        "event_registrations",
        ["event_id", "status", "registered_at"],
    )
    op.create_index(
        "ix_event_registrations_user_status_registered_at",
        "event_registrations",
        ["user_id", "status", "registered_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_event_registrations_user_status_registered_at",
        table_name="event_registrations",
    )
    op.drop_index(
        "ix_event_registrations_event_status_registered_at",
        table_name="event_registrations",
    )
    op.drop_table("event_registrations")
    op.drop_index("ix_campus_events_club_starts_at", table_name="campus_events")
    op.drop_index("ix_campus_events_status_starts_at", table_name="campus_events")
    op.drop_table("campus_events")
    op.drop_index(
        "ix_club_announcements_club_created_at",
        table_name="club_announcements",
    )
    op.drop_table("club_announcements")
    op.drop_index(
        "ix_club_memberships_user_status_created_at",
        table_name="club_memberships",
    )
    op.drop_index(
        "ix_club_memberships_club_status_created_at",
        table_name="club_memberships",
    )
    op.drop_table("club_memberships")
    op.drop_index("ix_clubs_name", table_name="clubs")
    op.drop_index("ix_clubs_status_updated_at", table_name="clubs")
    op.drop_table("clubs")
