from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, SecretStr, StringConstraints, field_validator

DisplayName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
]
Bio = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=500),
]


class ProfileVisibility(StrEnum):
    CAMPUS = "campus"
    PRIVATE = "private"


class VerificationStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ProfileUpdate(BaseModel):
    display_name: DisplayName | None = None
    bio: Bio | None = None
    avatar_url: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, max_length=500),
    ] = None

    @field_validator("avatar_url")
    @classmethod
    def validate_avatar_url(cls, value: str | None) -> str | None:
        if value and not value.startswith("https://"):
            raise ValueError("avatar_url must use HTTPS")
        return value or None


class PrivacyUpdate(BaseModel):
    profile_visibility: ProfileVisibility | None = None
    show_activity: bool | None = None
    allow_direct_messages: bool | None = None


class UserProfileRead(BaseModel):
    id: str
    username: str
    display_name: str
    bio: str | None
    avatar_url: str | None
    campus_verified: bool
    level: int
    reputation: int
    profile_visibility: ProfileVisibility
    show_activity: bool
    allow_direct_messages: bool
    follower_count: int
    following_count: int
    is_following: bool = False
    is_blocked: bool = False
    created_at: datetime


class SessionRead(BaseModel):
    id: str
    user_agent: str | None
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime
    current: bool


class SessionList(BaseModel):
    items: list[SessionRead]


class RelationshipRead(BaseModel):
    user_id: str
    following: bool
    blocked: bool


class CampusVerificationCreate(BaseModel):
    school_name: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=2, max_length=200),
    ]
    student_identifier: SecretStr
    proof_object_key: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, max_length=500),
    ] = None

    @field_validator("student_identifier")
    @classmethod
    def validate_student_identifier(cls, value: SecretStr) -> SecretStr:
        if not 3 <= len(value.get_secret_value().strip()) <= 100:
            raise ValueError("student_identifier must contain 3 to 100 characters")
        return value


class CampusVerificationReview(BaseModel):
    status: VerificationStatus
    review_note: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, max_length=1000),
    ] = None

    @field_validator("status")
    @classmethod
    def require_final_status(cls, value: VerificationStatus) -> VerificationStatus:
        if value is VerificationStatus.PENDING:
            raise ValueError("review status must be approved or rejected")
        return value


class CampusVerificationRead(BaseModel):
    id: str
    user_id: str
    school_name: str
    proof_object_key: str | None
    status: VerificationStatus
    review_note: str | None
    reviewed_by_user_id: str | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CampusVerificationList(BaseModel):
    items: list[CampusVerificationRead]
    total: int


class AccountDeleteRequest(BaseModel):
    password: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    confirmation: Annotated[str, StringConstraints(pattern=r"^DELETE$")]


class AccountDeleteResult(BaseModel):
    deleted: bool = True
    revoked_sessions: int = Field(ge=0)
