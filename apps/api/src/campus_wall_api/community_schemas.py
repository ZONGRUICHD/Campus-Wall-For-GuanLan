from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

ClubName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=100),
]
ClubDescription = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=20, max_length=5000),
]
ClubSlug = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        min_length=3,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]
ShortTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=120),
]
LongBody = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=10, max_length=10000),
]
Location = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=200),
]


class ClubStatus(StrEnum):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"
    SUSPENDED = "suspended"


class ClubRecruitmentStatus(StrEnum):
    OPEN = "open"
    CLOSED = "closed"
    PAUSED = "paused"


class ClubMembershipRole(StrEnum):
    OWNER = "owner"
    MANAGER = "manager"
    MEMBER = "member"


class ClubMembershipStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    REJECTED = "rejected"
    LEFT = "left"


class CampusEventStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class EventRegistrationStatus(StrEnum):
    REGISTERED = "registered"
    CANCELLED = "cancelled"
    CHECKED_IN = "checked_in"


class ClubCreate(BaseModel):
    name: ClubName
    slug: ClubSlug | None = None
    description: ClubDescription
    recruitment_status: ClubRecruitmentStatus = ClubRecruitmentStatus.CLOSED
    member_limit: int | None = Field(default=None, ge=1, le=5000)


class ClubUpdate(BaseModel):
    name: ClubName | None = None
    description: ClubDescription | None = None
    recruitment_status: ClubRecruitmentStatus | None = None
    member_limit: int | None = Field(default=None, ge=1, le=5000)

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one club field is required")
        return self


class ClubVerificationUpdate(BaseModel):
    status: ClubStatus
    note: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=2, max_length=1000),
    ]

    @model_validator(mode="after")
    def reject_pending(self) -> Self:
        if self.status is ClubStatus.PENDING:
            raise ValueError("verification status cannot be pending")
        return self


class ClubRead(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    owner_user_id: str | None
    owner_name: str
    status: ClubStatus
    recruitment_status: ClubRecruitmentStatus
    member_limit: int | None
    member_count: int
    membership_role: ClubMembershipRole | None = None
    membership_status: ClubMembershipStatus | None = None
    can_manage: bool = False
    verification_note: str | None = None
    created_at: datetime
    updated_at: datetime


class ClubList(BaseModel):
    items: list[ClubRead]
    total: int


class ClubMembershipApply(BaseModel):
    message: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=10, max_length=500),
    ]


class ClubMembershipReview(BaseModel):
    status: ClubMembershipStatus
    role: ClubMembershipRole = ClubMembershipRole.MEMBER

    @model_validator(mode="after")
    def validate_review(self) -> Self:
        if self.status not in {
            ClubMembershipStatus.ACTIVE,
            ClubMembershipStatus.REJECTED,
        }:
            raise ValueError("membership review must activate or reject the application")
        if (
            self.status is ClubMembershipStatus.REJECTED
            and self.role is not ClubMembershipRole.MEMBER
        ):
            raise ValueError("rejected memberships cannot receive a management role")
        if self.role is ClubMembershipRole.OWNER:
            raise ValueError("club ownership cannot be assigned through membership review")
        return self


class ClubMembershipRead(BaseModel):
    club_id: str
    user_id: str
    user_name: str
    role: ClubMembershipRole
    status: ClubMembershipStatus
    application_message: str | None
    can_review: bool = False
    created_at: datetime
    updated_at: datetime


class ClubMembershipList(BaseModel):
    items: list[ClubMembershipRead]
    total: int


class ClubAnnouncementCreate(BaseModel):
    title: ShortTitle
    body: LongBody


class ClubAnnouncementRead(BaseModel):
    id: str
    club_id: str
    author_name: str
    title: str
    body: str
    created_at: datetime
    updated_at: datetime


class ClubAnnouncementList(BaseModel):
    items: list[ClubAnnouncementRead]
    total: int


class CampusEventCreate(BaseModel):
    title: ShortTitle
    description: LongBody
    location: Location
    starts_at: datetime
    ends_at: datetime
    registration_deadline: datetime | None = None
    capacity: int | None = Field(default=None, ge=1, le=10000)
    status: CampusEventStatus = CampusEventStatus.DRAFT
    check_in_code: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=6, max_length=32),
        ]
        | None
    ) = None

    @field_validator("starts_at", "ends_at", "registration_deadline")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("event timestamps must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_times(self) -> Self:
        starts_at = self.starts_at.astimezone(UTC)
        ends_at = self.ends_at.astimezone(UTC)
        if ends_at <= starts_at:
            raise ValueError("ends_at must be after starts_at")
        if self.registration_deadline is not None:
            deadline = self.registration_deadline.astimezone(UTC)
            if deadline > starts_at:
                raise ValueError("registration_deadline must not be after starts_at")
        if self.status is CampusEventStatus.PUBLISHED and starts_at <= datetime.now(UTC):
            raise ValueError("published events must start in the future")
        return self


class CampusEventUpdate(BaseModel):
    title: ShortTitle | None = None
    description: LongBody | None = None
    location: Location | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    registration_deadline: datetime | None = None
    capacity: int | None = Field(default=None, ge=1, le=10000)
    status: CampusEventStatus | None = None
    check_in_code: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=6, max_length=32),
        ]
        | None
    ) = None

    @field_validator("starts_at", "ends_at", "registration_deadline")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("event timestamps must include a timezone")
        return value

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one event field is required")
        return self


class CampusEventRead(BaseModel):
    id: str
    club_id: str
    club_name: str
    organizer_user_id: str | None
    organizer_name: str
    title: str
    description: str
    location: str
    starts_at: datetime
    ends_at: datetime
    registration_deadline: datetime | None
    capacity: int | None
    registered_count: int
    status: CampusEventStatus
    registration_status: EventRegistrationStatus | None = None
    registration_open: bool
    check_in_configured: bool
    check_in_open: bool
    can_manage: bool = False
    created_at: datetime
    updated_at: datetime


class CampusEventList(BaseModel):
    items: list[CampusEventRead]
    total: int


class EventRegistrationRead(BaseModel):
    event_id: str
    user_id: str
    user_name: str
    status: EventRegistrationStatus
    registered_at: datetime
    checked_in_at: datetime | None
    updated_at: datetime


class EventRegistrationList(BaseModel):
    items: list[EventRegistrationRead]
    total: int


class EventCheckIn(BaseModel):
    code: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=6, max_length=32),
    ]
