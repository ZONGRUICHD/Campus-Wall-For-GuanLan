from datetime import datetime
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator


class NotificationType(StrEnum):
    COMMENT = "comment"
    REPLY = "reply"
    REACTION = "reaction"
    FOLLOW = "follow"
    MEMBERSHIP = "membership"
    ANNOUNCEMENT = "announcement"
    EVENT = "event"
    SUBSCRIPTION = "subscription"
    MODERATION = "moderation"
    SYSTEM = "system"


class SubscriptionTargetType(StrEnum):
    BOARD = "board"
    TAG = "tag"
    CLUB = "club"
    EVENT = "event"


class NotificationRead(BaseModel):
    id: str
    type: NotificationType
    actor_user_id: str | None
    actor_name: str
    entity_type: str
    entity_id: str
    title: str
    body: str
    read: bool
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationRead]
    total: int
    next_cursor: str | None = None


class NotificationUnreadCount(BaseModel):
    unread_count: int = Field(ge=0)


class NotificationMarkRead(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=100)
    all: bool = False

    @model_validator(mode="after")
    def require_target(self) -> Self:
        if not self.all and not self.ids:
            raise ValueError("provide notification ids or set all=true")
        if self.all and self.ids:
            raise ValueError("ids and all=true are mutually exclusive")
        if len(self.ids) != len(set(self.ids)):
            raise ValueError("notification ids must not contain duplicates")
        return self


class SubscriptionRead(BaseModel):
    target_type: SubscriptionTargetType
    target_id: str
    label: str
    created_at: datetime


class SubscriptionList(BaseModel):
    items: list[SubscriptionRead]
    total: int


class SearchPostHit(BaseModel):
    id: int
    board: str
    title: str | None
    excerpt: str
    author_name: str
    author_user_id: str | None
    tags: list[str]
    created_at: datetime


class SearchUserHit(BaseModel):
    id: str
    username: str
    display_name: str
    bio: str | None
    avatar_url: str | None
    campus_verified: bool
    is_following: bool


class SearchClubHit(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    recruitment_status: str
    subscribed: bool


class SearchEventHit(BaseModel):
    id: str
    club_id: str
    club_name: str
    title: str
    description: str
    location: str
    starts_at: datetime
    subscribed: bool


class SearchTagHit(BaseModel):
    name: str
    post_count: int = Field(ge=1)
    subscribed: bool


class GlobalSearchResponse(BaseModel):
    query: str
    posts: list[SearchPostHit] = Field(default_factory=list)
    users: list[SearchUserHit] = Field(default_factory=list)
    clubs: list[SearchClubHit] = Field(default_factory=list)
    events: list[SearchEventHit] = Field(default_factory=list)
    tags: list[SearchTagHit] = Field(default_factory=list)
    total: int = Field(ge=0)


class SearchHistoryRead(BaseModel):
    id: str
    query: str
    created_at: datetime


class SearchHistoryList(BaseModel):
    items: list[SearchHistoryRead]


class OutboxDispatchResult(BaseModel):
    processed: int = Field(ge=0)
    remaining: int = Field(ge=0)


SearchQuery = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=100),
]
