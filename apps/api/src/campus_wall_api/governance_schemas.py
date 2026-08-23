from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

LongText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=2000),
]


class ReportTargetType(StrEnum):
    POST = "post"
    COMMENT = "comment"
    USER = "user"


class ReportCategory(StrEnum):
    HARASSMENT = "harassment"
    PRIVACY = "privacy"
    MISINFORMATION = "misinformation"
    VIOLENCE = "violence"
    SPAM = "spam"
    ILLEGAL = "illegal"
    OTHER = "other"


class ReportStatus(StrEnum):
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    RESOLVED = "resolved"
    REJECTED = "rejected"


class ReportCreate(BaseModel):
    target_type: ReportTargetType
    target_id: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    ]
    category: ReportCategory
    description: LongText
    emergency: bool = False
    evidence_object_keys: list[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
    ] = Field(default_factory=list)

    @field_validator("evidence_object_keys")
    @classmethod
    def limit_evidence(cls, value: list[str]) -> list[str]:
        if len(value) > 5:
            raise ValueError("at most five evidence objects are allowed")
        if len(value) != len(set(value)):
            raise ValueError("evidence objects must be unique")
        return value


class ReportRead(BaseModel):
    id: str
    reporter_user_id: str
    target_type: ReportTargetType
    target_id: str
    category: ReportCategory
    description: str
    emergency: bool
    priority: int
    status: ReportStatus
    assigned_to_user_id: str | None
    resolution: str | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class ReportList(BaseModel):
    items: list[ReportRead]
    total: int


class ReportReview(BaseModel):
    status: ReportStatus
    resolution: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, max_length=2000),
    ] = None
    assign_to_me: bool = True
    hide_target: bool = False

    @model_validator(mode="after")
    def require_resolution(self) -> ReportReview:
        if self.status in {ReportStatus.RESOLVED, ReportStatus.REJECTED} and not self.resolution:
            raise ValueError("a final report status requires a resolution")
        return self


class AppealTargetType(StrEnum):
    POST = "post"
    COMMENT = "comment"
    USER = "user"
    REPORT = "report"


class AppealStatus(StrEnum):
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class AppealCreate(BaseModel):
    target_type: AppealTargetType
    target_id: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    ]
    reason: LongText


class AppealRead(BaseModel):
    id: str
    appellant_user_id: str
    target_type: AppealTargetType
    target_id: str
    reason: str
    status: AppealStatus
    reviewed_by_user_id: str | None
    resolution: str | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class AppealList(BaseModel):
    items: list[AppealRead]
    total: int


class AppealReview(BaseModel):
    status: AppealStatus
    resolution: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, max_length=2000),
    ] = None

    @model_validator(mode="after")
    def require_final_resolution(self) -> AppealReview:
        if self.status in {AppealStatus.APPROVED, AppealStatus.REJECTED} and not self.resolution:
            raise ValueError("a final appeal status requires a resolution")
        return self


class ModerationStatus(StrEnum):
    PUBLISHED = "published"
    HIDDEN = "hidden"


class ModerationUpdate(BaseModel):
    status: ModerationStatus
    reason: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, max_length=1000),
    ] = None

    @model_validator(mode="after")
    def require_hidden_reason(self) -> ModerationUpdate:
        if self.status is ModerationStatus.HIDDEN and not self.reason:
            raise ValueError("hiding content requires a reason")
        return self


class ModerationResult(BaseModel):
    target_type: str
    target_id: str
    status: ModerationStatus
    reason: str | None


class AuditLogRead(BaseModel):
    id: int
    actor_user_id: str | None
    action: str
    target_type: str
    target_id: str | None
    details: dict[str, Any]
    created_at: datetime


class AuditLogList(BaseModel):
    items: list[AuditLogRead]
    total: int


class UserStatusUpdate(BaseModel):
    status: Annotated[str, StringConstraints(pattern=r"^(active|suspended)$")]
    reason: LongText
