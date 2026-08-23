from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


class Board(StrEnum):
    NEWS = "news"
    DAILY = "daily"
    LOST_FOUND = "lost_found"
    CONFESSION = "confession"
    TREE_HOLE = "tree_hole"


class LostFoundKind(StrEnum):
    LOST = "lost"
    FOUND = "found"


class LostFoundState(StrEnum):
    ALL = "all"
    UNRESOLVED = "unresolved"
    RESOLVED = "resolved"


class PostSort(StrEnum):
    LATEST = "latest"
    OLDEST = "oldest"
    POPULAR = "popular"


class PublicationStatus(StrEnum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    PUBLISHED = "published"


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)]
AuthorName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)]
Location = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class PostCreate(BaseModel):
    title: Title | None = None
    body: Body
    board: Board
    author_name: AuthorName = "同学"
    anonymous: bool = False
    tags: list[Tag] = Field(default_factory=list, max_length=8)
    kind: LostFoundKind | None = None
    location: Location | None = None
    resolved: bool = False
    publication_status: PublicationStatus = PublicationStatus.PUBLISHED
    scheduled_for: datetime | None = None
    comments_enabled: bool = True

    @field_validator("tags")
    @classmethod
    def deduplicate_tags(cls, tags: list[str]) -> list[str]:
        unique_tags: list[str] = []
        seen: set[str] = set()
        for tag in tags:
            key = tag.casefold()
            if key not in seen:
                seen.add(key)
                unique_tags.append(tag)
        return unique_tags

    @model_validator(mode="after")
    def validate_board_fields(self) -> Self:
        if self.board in {Board.NEWS, Board.LOST_FOUND} and self.title is None:
            raise ValueError("title is required for news and lost_found posts")

        if self.board is Board.LOST_FOUND:
            if self.kind is None:
                raise ValueError("kind is required for lost_found posts")
        elif self.kind is not None or self.location is not None or self.resolved:
            raise ValueError("kind, location and resolved are only valid for lost_found posts")
        if self.publication_status is PublicationStatus.SCHEDULED:
            if self.scheduled_for is None:
                raise ValueError("scheduled_for is required for scheduled posts")
            scheduled_for = self.scheduled_for
            if scheduled_for.tzinfo is None:
                scheduled_for = scheduled_for.replace(tzinfo=UTC)
            if scheduled_for <= datetime.now(UTC):
                raise ValueError("scheduled_for must be in the future")
        elif self.scheduled_for is not None:
            raise ValueError("scheduled_for is only valid for scheduled posts")
        return self


class CommentCreate(BaseModel):
    body: Body
    author_name: AuthorName = "同学"
    anonymous: bool = False
    parent_id: int | None = Field(default=None, ge=1)


class CommentUpdate(BaseModel):
    body: Body


class PostUpdate(BaseModel):
    title: Title | None = None
    body: Body | None = None
    tags: list[Tag] | None = Field(default=None, max_length=8)
    anonymous: bool | None = None
    comments_enabled: bool | None = None
    publication_status: PublicationStatus | None = None
    scheduled_for: datetime | None = None

    @field_validator("scheduled_for")
    @classmethod
    def validate_future_schedule(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        scheduled_for = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
        if scheduled_for <= datetime.now(UTC):
            raise ValueError("scheduled_for must be in the future")
        return value

    @model_validator(mode="after")
    def validate_schedule(self) -> Self:
        if self.publication_status is PublicationStatus.SCHEDULED:
            if self.scheduled_for is None:
                raise ValueError("scheduled_for is required for scheduled posts")
            scheduled_for = self.scheduled_for
            if scheduled_for.tzinfo is None:
                scheduled_for = scheduled_for.replace(tzinfo=UTC)
            if scheduled_for <= datetime.now(UTC):
                raise ValueError("scheduled_for must be in the future")
        elif self.publication_status is not None and self.scheduled_for is not None:
            raise ValueError("scheduled_for is only valid for scheduled posts")
        return self


class CommentRead(BaseModel):
    id: int
    post_id: int
    body: str
    author_name: str
    anonymous: bool
    parent_id: int | None
    depth: int
    reaction_count: int = 0
    liked: bool = False
    edited_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PostRead(BaseModel):
    id: int
    title: str | None
    body: str
    board: Board
    author_name: str
    anonymous: bool
    tags: list[str]
    kind: LostFoundKind | None
    location: str | None
    resolved: bool
    publication_status: PublicationStatus
    scheduled_for: datetime | None
    edited_at: datetime | None
    comments_enabled: bool
    reaction_count: int
    liked: bool
    bookmarked: bool = False
    comment_count: int
    comments: list[CommentRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PostList(BaseModel):
    items: list[PostRead]
    next_cursor: str | None


class ReactionRead(BaseModel):
    post_id: int
    reaction_count: int
    liked: bool


class BookmarkRead(BaseModel):
    post_id: int
    bookmarked: bool


class CommentReactionRead(BaseModel):
    comment_id: int
    reaction_count: int
    liked: bool


class PublishDueResult(BaseModel):
    published: int


class ResolutionUpdate(BaseModel):
    resolved: bool


class ResolutionRead(BaseModel):
    post_id: int
    resolved: bool
    updated_at: datetime


class SeedResult(BaseModel):
    inserted: int
    existing: int
    total: int
