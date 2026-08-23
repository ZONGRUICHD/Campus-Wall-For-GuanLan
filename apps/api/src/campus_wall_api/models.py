from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

BOARD_VALUES = ("news", "daily", "lost_found", "confession", "tree_hole")
LOST_FOUND_KIND_VALUES = ("lost", "found")
LOST_FOUND_CATEGORY_VALUES = (
    "documents",
    "electronics",
    "keys",
    "clothing",
    "books",
    "other",
)
LOST_FOUND_CLAIM_STATUS_VALUES = ("pending", "accepted", "rejected", "cancelled")
USER_STATUS_VALUES = ("active", "suspended", "deleted")
ROLE_VALUES = ("student", "moderator", "admin", "super_admin")
PROFILE_VISIBILITY_VALUES = ("campus", "private")
VERIFICATION_STATUS_VALUES = ("pending", "approved", "rejected")
CONTENT_STATUS_VALUES = ("pending", "published", "hidden", "deleted")
REPORT_STATUS_VALUES = ("submitted", "in_review", "resolved", "rejected")
APPEAL_STATUS_VALUES = ("submitted", "in_review", "approved", "rejected")
PUBLICATION_STATUS_VALUES = ("draft", "scheduled", "published")
MEDIA_ASSET_STATUS_VALUES = ("pending", "ready", "rejected", "deleted")


def utc_now() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Store timestamps with timezone intent and restore SQLite values as UTC."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'suspended', 'deleted')",
            name="ck_users_status",
        ),
        CheckConstraint(
            "profile_visibility IN ('campus', 'private')",
            name="ck_users_profile_visibility",
        ),
        Index("ix_users_status_created_at", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    normalized_username: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, unique=True)
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)
    bio: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default="active"
    )
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    campus_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    reputation: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100, server_default="100"
    )
    profile_visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, default="campus", server_default="campus"
    )
    show_activity: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=func.true()
    )
    allow_direct_messages: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=func.true()
    )
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (
        CheckConstraint(
            "name IN ('student', 'moderator', 'admin', 'super_admin')",
            name="ck_roles_name",
        ),
    )

    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=func.true()
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class Permission(Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(100), primary_key=True)
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_name: Mapped[str] = mapped_column(
        ForeignKey("roles.name", ondelete="CASCADE"), primary_key=True
    )
    permission_code: Mapped[str] = mapped_column(
        ForeignKey("permissions.code", ondelete="CASCADE"), primary_key=True
    )


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (Index("ix_user_roles_role_name_user_id", "role_name", "user_id"),)

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_name: Mapped[str] = mapped_column(
        ForeignKey("roles.name", ondelete="RESTRICT"), primary_key=True
    )
    granted_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_user_id_expires_at", "user_id", "expires_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_actor_created_at", "actor_user_id", "created_at"),
        Index("ix_audit_logs_target_created_at", "target_type", "target_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class UserFollow(Base):
    __tablename__ = "user_follows"
    __table_args__ = (
        CheckConstraint("follower_id <> followed_id", name="ck_user_follows_distinct"),
        Index("ix_user_follows_followed_created_at", "followed_id", "created_at"),
    )

    follower_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    followed_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class UserBlock(Base):
    __tablename__ = "user_blocks"
    __table_args__ = (CheckConstraint("blocker_id <> blocked_id", name="ck_user_blocks_distinct"),)

    blocker_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    blocked_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class CampusVerification(Base):
    __tablename__ = "campus_verifications"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_campus_verifications_status",
        ),
        Index("ix_campus_verifications_status_created_at", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    school_name: Mapped[str] = mapped_column(String(200), nullable=False)
    student_identifier_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    proof_object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    review_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (
        CheckConstraint(
            "board IN ('news', 'daily', 'lost_found', 'confession', 'tree_hole')",
            name="ck_posts_board",
        ),
        CheckConstraint(
            "lost_found_kind IS NULL OR lost_found_kind IN ('lost', 'found')",
            name="ck_posts_lost_found_kind",
        ),
        CheckConstraint(
            "lost_found_category IS NULL OR lost_found_category IN "
            "('documents', 'electronics', 'keys', 'clothing', 'books', 'other')",
            name="ck_posts_lost_found_category",
        ),
        CheckConstraint(
            "(board = 'lost_found' AND lost_found_kind IS NOT NULL "
            "AND lost_found_category IS NOT NULL AND occurred_at IS NOT NULL) OR "
            "(board <> 'lost_found' AND lost_found_kind IS NULL "
            "AND lost_found_category IS NULL AND occurred_at IS NULL "
            "AND location IS NULL AND resolved = false)",
            name="ck_posts_lost_found_fields",
        ),
        CheckConstraint(
            "status IN ('pending', 'published', 'hidden', 'deleted')",
            name="ck_posts_status",
        ),
        CheckConstraint(
            "publication_status IN ('draft', 'scheduled', 'published')",
            name="ck_posts_publication_status",
        ),
        UniqueConstraint("seed_key", name="uq_posts_seed_key"),
        Index("ix_posts_board_created_at_id", "board", "created_at", "id"),
        Index("ix_posts_lost_found_resolved", "board", "resolved"),
        Index(
            "ix_posts_lost_found_category_occurred_at",
            "board",
            "lost_found_category",
            "occurred_at",
        ),
        Index("ix_posts_author_user_id_created_at", "author_user_id", "created_at"),
        Index("ix_posts_status_created_at", "status", "created_at"),
        Index(
            "ix_posts_publication_status_scheduled_for",
            "publication_status",
            "scheduled_for",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    board: Mapped[str] = mapped_column(String(32), nullable=False)
    author_name: Mapped[str] = mapped_column(String(50), nullable=False)
    author_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    lost_found_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    lost_found_category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    occurred_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    resolved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="published", server_default="published"
    )
    publication_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="published", server_default="published"
    )
    scheduled_for: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    comments_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=func.true()
    )
    moderation_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    moderated_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    moderated_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    seed_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class LostFoundClaim(Base):
    __tablename__ = "lost_found_claims"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected', 'cancelled')",
            name="ck_lost_found_claims_status",
        ),
        UniqueConstraint(
            "post_id",
            "claimant_user_id",
            name="uq_lost_found_claims_post_claimant",
        ),
        Index(
            "ix_lost_found_claims_post_status_created_at",
            "post_id",
            "status",
            "created_at",
        ),
        Index(
            "ix_lost_found_claims_claimant_created_at",
            "claimant_user_id",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), nullable=False
    )
    claimant_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    message: Mapped[str] = mapped_column(String(1000), nullable=False)
    anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=func.true()
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class MediaAsset(Base):
    __tablename__ = "media_assets"
    __table_args__ = (
        CheckConstraint("kind = 'image'", name="ck_media_assets_kind"),
        CheckConstraint(
            "content_type IN ('image/jpeg', 'image/png', 'image/webp')",
            name="ck_media_assets_content_type",
        ),
        CheckConstraint("byte_size > 0", name="ck_media_assets_byte_size"),
        CheckConstraint(
            "(pixel_width IS NULL AND pixel_height IS NULL) OR "
            "(pixel_width > 0 AND pixel_height > 0)",
            name="ck_media_assets_dimensions",
        ),
        CheckConstraint(
            "status IN ('pending', 'ready', 'rejected', 'deleted')",
            name="ck_media_assets_status",
        ),
        Index(
            "ix_media_assets_owner_status_created_at",
            "owner_user_id",
            "status",
            "created_at",
        ),
        Index("ix_media_assets_expires_at", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    object_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(20), nullable=False, default="image", server_default="image"
    )
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    pixel_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pixel_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class PostMedia(Base):
    __tablename__ = "post_media"
    __table_args__ = (
        CheckConstraint("position >= 0 AND position < 9", name="ck_post_media_position"),
        UniqueConstraint("post_id", "position", name="uq_post_media_post_position"),
        UniqueConstraint("media_asset_id", name="uq_post_media_asset"),
        Index("ix_post_media_post_position", "post_id", "position"),
    )

    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    media_asset_id: Mapped[str] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class Reaction(Base):
    __tablename__ = "reactions"

    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    actor: Mapped[str] = mapped_column(String(100), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class PostBookmark(Base):
    __tablename__ = "post_bookmarks"
    __table_args__ = (Index("ix_post_bookmarks_user_created_at", "user_id", "created_at"),)

    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'published', 'hidden', 'deleted')",
            name="ck_comments_status",
        ),
        CheckConstraint("depth BETWEEN 0 AND 2", name="ck_comments_depth"),
        Index("ix_comments_post_id_created_at", "post_id", "created_at"),
        Index("ix_comments_parent_id_created_at", "parent_id", "created_at"),
        Index("ix_comments_author_user_id_created_at", "author_user_id", "created_at"),
        Index("ix_comments_status_created_at", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), nullable=True
    )
    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author_name: Mapped[str] = mapped_column(String(50), nullable=False)
    author_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="published", server_default="published"
    )
    moderation_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    moderated_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    moderated_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class CommentReaction(Base):
    __tablename__ = "comment_reactions"

    comment_id: Mapped[int] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint(
            "target_type IN ('post', 'comment', 'user')",
            name="ck_reports_target_type",
        ),
        CheckConstraint(
            "category IN "
            "('harassment', 'privacy', 'misinformation', 'violence', "
            "'spam', 'illegal', 'other')",
            name="ck_reports_category",
        ),
        CheckConstraint(
            "status IN ('submitted', 'in_review', 'resolved', 'rejected')",
            name="ck_reports_status",
        ),
        Index("ix_reports_status_priority_created_at", "status", "priority", "created_at"),
        Index("ix_reports_reporter_created_at", "reporter_user_id", "created_at"),
        Index("ix_reports_target_created_at", "target_type", "target_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    reporter_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str] = mapped_column(String(2000), nullable=False)
    emergency: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=50, server_default="50")
    evidence_object_keys: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="submitted", server_default="submitted"
    )
    assigned_to_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolution: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class Appeal(Base):
    __tablename__ = "appeals"
    __table_args__ = (
        CheckConstraint(
            "target_type IN ('post', 'comment', 'user', 'report')",
            name="ck_appeals_target_type",
        ),
        CheckConstraint(
            "status IN ('submitted', 'in_review', 'approved', 'rejected')",
            name="ck_appeals_status",
        ),
        Index("ix_appeals_status_created_at", "status", "created_at"),
        Index("ix_appeals_appellant_created_at", "appellant_user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    appellant_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[str] = mapped_column(String(100), nullable=False)
    reason: Mapped[str] = mapped_column(String(2000), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="submitted", server_default="submitted"
    )
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolution: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
