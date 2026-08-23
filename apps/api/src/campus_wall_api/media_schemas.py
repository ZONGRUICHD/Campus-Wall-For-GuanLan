from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

ImageContentType = Literal["image/jpeg", "image/png", "image/webp"]
FileName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]


class MediaUploadCreate(BaseModel):
    file_name: FileName
    content_type: ImageContentType
    byte_size: int = Field(ge=1, le=20 * 1024 * 1024)


class MediaUploadTicket(BaseModel):
    media_id: str
    object_key: str
    upload_url: str
    upload_method: Literal["PUT"] = "PUT"
    upload_headers: dict[str, str]
    expires_at: datetime


class MediaUploadCompleteRead(BaseModel):
    media_id: str
    status: Literal["ready"]
    content_type: ImageContentType
    byte_size: int
    pixel_width: int | None = Field(default=None, gt=0)
    pixel_height: int | None = Field(default=None, gt=0)


class PostMediaRead(BaseModel):
    id: str
    url: str
    content_type: ImageContentType
    byte_size: int
    pixel_width: int | None = Field(default=None, gt=0)
    pixel_height: int | None = Field(default=None, gt=0)
    position: int
