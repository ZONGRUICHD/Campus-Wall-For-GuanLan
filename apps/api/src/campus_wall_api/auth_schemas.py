from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator


Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=3,
        max_length=32,
        pattern=r"^[A-Za-z0-9_.-]+$",
    ),
]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
DisplayName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
]


class RegisterRequest(BaseModel):
    username: Username
    password: Password
    display_name: DisplayName
    email: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, min_length=3, max_length=320),
    ] = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, email: str | None) -> str | None:
        return email.casefold() if email else None


class LoginRequest(BaseModel):
    username: Username
    password: Password


class RefreshRequest(BaseModel):
    refresh_token: Annotated[str, StringConstraints(min_length=32, max_length=512)]


class ChangePasswordRequest(BaseModel):
    current_password: Password
    new_password: Password


class UserRead(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None
    status: str
    campus_verified: bool
    must_change_password: bool
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    created_at: datetime
    last_login_at: datetime | None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead


class RoleChangeRead(BaseModel):
    user_id: str
    roles: list[str]


class UserList(BaseModel):
    items: list[UserRead]
    total: int


class BootstrapAdminResult(BaseModel):
    username: str
    created: bool
    role: str = "super_admin"
    must_change_password: bool
