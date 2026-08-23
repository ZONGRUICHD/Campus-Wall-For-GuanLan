from datetime import UTC, datetime
from typing import Any

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
            "(board = 'lost_found' AND lost_found_kind IS NOT NULL) OR "
            "(board <> 'lost_found' AND lost_found_kind IS NULL "
            "AND location IS NULL AND resolved = false)",
            name="ck_posts_lost_found_fields",
        ),
        UniqueConstraint("seed_key", name="uq_posts_seed_key"),
        Index("ix_posts_board_created_at_id", "board", "created_at", "id"),
        Index("ix_posts_lost_found_resolved", "board", "resolved"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    board: Mapped[str] = mapped_column(String(32), nullable=False)
    author_name: Mapped[str] = mapped_column(String(50), nullable=False)
    anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    lost_found_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    resolved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    seed_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
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


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (Index("ix_comments_post_id_created_at", "post_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author_name: Mapped[str] = mapped_column(String(50), nullable=False)
    anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, server_default=func.current_timestamp()
    )
