from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator


class MarketplaceCategory(StrEnum):
    BOOKS = "books"
    ELECTRONICS = "electronics"
    DAILY_SUPPLIES = "daily_supplies"
    SPORTS = "sports"
    CLOTHING = "clothing"
    COLLECTIBLES = "collectibles"
    OTHER = "other"


class MarketplaceCondition(StrEnum):
    NEW = "new"
    LIKE_NEW = "like_new"
    GOOD = "good"
    FAIR = "fair"


class MarketplaceTradeMethod(StrEnum):
    CAMPUS_MEETUP = "campus_meetup"
    SELF_PICKUP = "self_pickup"


class MarketplaceStatus(StrEnum):
    AVAILABLE = "available"
    RESERVED = "reserved"
    SOLD = "sold"
    WITHDRAWN = "withdrawn"


class MarketplaceInquiryStatus(StrEnum):
    PENDING = "pending"
    REPLIED = "replied"
    CLOSED = "closed"
    CANCELLED = "cancelled"


MeetupLocation = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=200),
]
InquiryMessage = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=1000),
]


class MarketplaceListingCreate(BaseModel):
    category: MarketplaceCategory
    condition: MarketplaceCondition
    price_cents: int = Field(ge=0, le=10_000_000)
    original_price_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    negotiable: bool = False
    trade_method: MarketplaceTradeMethod
    meetup_location: MeetupLocation

    @model_validator(mode="after")
    def validate_price_reference(self) -> Self:
        if self.original_price_cents is not None and self.original_price_cents < self.price_cents:
            raise ValueError("original_price_cents cannot be lower than price_cents")
        return self


class MarketplaceListingUpdate(BaseModel):
    category: MarketplaceCategory | None = None
    condition: MarketplaceCondition | None = None
    price_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    original_price_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    negotiable: bool | None = None
    trade_method: MarketplaceTradeMethod | None = None
    meetup_location: MeetupLocation | None = None
    status: MarketplaceStatus | None = None


class MarketplaceListingRead(BaseModel):
    category: MarketplaceCategory
    condition: MarketplaceCondition
    price_cents: int
    original_price_cents: int | None
    negotiable: bool
    trade_method: MarketplaceTradeMethod
    meetup_location: str
    status: MarketplaceStatus
    seller_user_id: str | None


class MarketplaceStatusUpdate(BaseModel):
    status: MarketplaceStatus


class MarketplaceInquiryCreate(BaseModel):
    message: InquiryMessage
    anonymous: bool = True


class MarketplaceInquiryReply(BaseModel):
    seller_reply: InquiryMessage
    status: Literal[
        MarketplaceInquiryStatus.REPLIED,
        MarketplaceInquiryStatus.CLOSED,
    ] = MarketplaceInquiryStatus.REPLIED


class MarketplaceInquiryRead(BaseModel):
    id: str
    post_id: int
    message: str
    anonymous: bool
    buyer_name: str
    seller_reply: str | None
    status: MarketplaceInquiryStatus
    is_mine: bool
    can_reply: bool
    created_at: datetime
    updated_at: datetime
    replied_at: datetime | None


class MarketplaceInquiryList(BaseModel):
    items: list[MarketplaceInquiryRead]


PROHIBITED_MARKETPLACE_TERMS = (
    "香烟",
    "电子烟",
    "烟弹",
    "白酒",
    "啤酒",
    "酒精饮料",
    "校园卡",
    "学生证",
    "身份证",
    "银行卡",
    "游戏账号",
    "社交账号",
    "考试答案",
    "代写",
    "代考",
    "处方药",
    "药品",
    "管制刀具",
    "弓弩",
    "仿真枪",
    "博彩",
    "彩票",
    "色情",
)


def prohibited_marketplace_term(*values: str | None) -> str | None:
    searchable = " ".join(value or "" for value in values).casefold()
    return next(
        (term for term in PROHIBITED_MARKETPLACE_TERMS if term.casefold() in searchable),
        None,
    )
