from datetime import datetime
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, StringConstraints, model_validator

ClaimMessage = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=10, max_length=1000),
]


class LostFoundClaimStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class LostFoundClaimCreate(BaseModel):
    message: ClaimMessage
    anonymous: bool = True


class LostFoundClaimReview(BaseModel):
    status: LostFoundClaimStatus

    @model_validator(mode="after")
    def require_review_status(self) -> Self:
        if self.status not in {
            LostFoundClaimStatus.ACCEPTED,
            LostFoundClaimStatus.REJECTED,
        }:
            raise ValueError("claim reviews must accept or reject the claim")
        return self


class LostFoundClaimRead(BaseModel):
    id: str
    post_id: int
    message: str
    anonymous: bool
    claimant_name: str
    status: LostFoundClaimStatus
    is_mine: bool
    can_review: bool
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None


class LostFoundClaimList(BaseModel):
    items: list[LostFoundClaimRead]
    total: int
