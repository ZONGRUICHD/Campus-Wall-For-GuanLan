from datetime import datetime
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator


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


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)]
AuthorName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)]
Location = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


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
            return self

        if self.kind is not None or self.location is not None or self.resolved:
            raise ValueError("kind, location and resolved are only valid for lost_found posts")
        return self


class CommentCreate(BaseModel):
    body: Body
    author_name: AuthorName = "同学"
    anonymous: bool = False


class CommentRead(BaseModel):
    id: int
    post_id: int
    body: str
    author_name: str
    anonymous: bool
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
    reaction_count: int
    liked: bool
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
