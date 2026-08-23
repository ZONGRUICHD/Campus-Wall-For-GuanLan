import hashlib
import secrets
import warnings
from dataclasses import dataclass
from io import BytesIO
from threading import Lock
from typing import Any
from urllib.parse import quote

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError
from PIL import Image, ImageOps, UnidentifiedImageError

from campus_wall_api.config import Settings
from campus_wall_api.models import MediaAsset


class MediaStorageError(RuntimeError):
    pass


class StorageObjectMissing(MediaStorageError):
    pass


class InvalidUploadedImage(MediaStorageError):
    pass


@dataclass(frozen=True, slots=True)
class UploadTarget:
    url: str
    headers: dict[str, str]


@dataclass(frozen=True, slots=True)
class UploadedObject:
    content_type: str
    byte_size: int
    checksum_sha256: str | None


@dataclass(frozen=True, slots=True)
class SanitizedObject:
    object_key: str
    content_type: str
    byte_size: int
    checksum_sha256: str
    pixel_width: int
    pixel_height: int


def validate_image_signature(content_type: str, prefix: bytes) -> None:
    valid = (
        (content_type == "image/jpeg" and prefix.startswith(b"\xff\xd8\xff"))
        or (content_type == "image/png" and prefix.startswith(b"\x89PNG\r\n\x1a\n"))
        or (content_type == "image/webp" and prefix.startswith(b"RIFF") and prefix[8:12] == b"WEBP")
    )
    if not valid:
        raise InvalidUploadedImage("uploaded bytes do not match the declared image type")


def _final_object_key(asset: MediaAsset) -> str:
    if asset.object_key.startswith("pending/"):
        return "posts/" + asset.object_key.removeprefix("pending/")
    return asset.object_key


def sanitize_image(
    content_type: str,
    payload: bytes,
    *,
    max_bytes: int,
    max_pixels: int,
    object_key: str,
) -> tuple[bytes, SanitizedObject]:
    validate_image_signature(content_type, payload[:16])
    expected_format = {
        "image/jpeg": "JPEG",
        "image/png": "PNG",
        "image/webp": "WEBP",
    }[content_type]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as source:
                if source.format != expected_format:
                    raise InvalidUploadedImage(
                        "decoded image format does not match the declared content type"
                    )
                if bool(getattr(source, "is_animated", False)):
                    raise InvalidUploadedImage("animated images are not supported")
                width, height = source.size
                if width < 1 or height < 1 or width * height > max_pixels:
                    raise InvalidUploadedImage(
                        f"image dimensions exceed the {max_pixels} pixel limit"
                    )
                source.load()
                normalized = ImageOps.exif_transpose(source)
                if content_type == "image/jpeg":
                    if normalized.mode in {"RGBA", "LA"}:
                        background = Image.new("RGB", normalized.size, "white")
                        alpha = normalized.getchannel("A")
                        background.paste(normalized.convert("RGB"), mask=alpha)
                        output_image = background
                    else:
                        output_image = normalized.convert("RGB")
                    save_options: dict[str, Any] = {
                        "format": "JPEG",
                        "quality": 90,
                        "optimize": True,
                        "progressive": True,
                    }
                elif content_type == "image/png":
                    output_image = (
                        normalized
                        if normalized.mode in {"L", "LA", "RGB", "RGBA"}
                        else normalized.convert("RGBA")
                    )
                    save_options = {"format": "PNG", "optimize": True}
                else:
                    output_image = (
                        normalized
                        if normalized.mode in {"RGB", "RGBA"}
                        else normalized.convert("RGBA")
                    )
                    save_options = {
                        "format": "WEBP",
                        "quality": 88,
                        "method": 4,
                    }

                pixel_width, pixel_height = output_image.size
                output = BytesIO()
                output_image.save(output, **save_options)
                sanitized = output.getvalue()
    except InvalidUploadedImage:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        UnidentifiedImageError,
        ValueError,
    ) as exc:
        raise InvalidUploadedImage("uploaded file is not a safe decodable image") from exc

    if len(sanitized) < 1 or len(sanitized) > max_bytes:
        raise InvalidUploadedImage("sanitized image exceeds the configured upload size limit")
    validate_image_signature(content_type, sanitized[:16])
    return (
        sanitized,
        SanitizedObject(
            object_key=object_key,
            content_type=content_type,
            byte_size=len(sanitized),
            checksum_sha256=hashlib.sha256(sanitized).hexdigest(),
            pixel_width=pixel_width,
            pixel_height=pixel_height,
        ),
    )


class MediaStorage:
    def create_upload(self, asset: MediaAsset, *, expires_in: int) -> UploadTarget:
        raise NotImplementedError

    def verify_upload(self, asset: MediaAsset) -> UploadedObject:
        raise NotImplementedError

    def sanitize_upload(self, asset: MediaAsset) -> SanitizedObject:
        raise NotImplementedError

    def delete(self, asset: MediaAsset) -> None:
        raise NotImplementedError

    def put_development_content(
        self,
        asset: MediaAsset,
        *,
        token: str,
        content_type: str,
        payload: bytes,
    ) -> None:
        raise MediaStorageError("development upload endpoint is disabled")

    def read_development_content(self, asset_id: str) -> bytes | None:
        return None


class DevelopmentMediaStorage(MediaStorage):
    def __init__(self, *, max_bytes: int, max_pixels: int) -> None:
        self._tokens: dict[str, str] = {}
        self._objects: dict[str, tuple[str, bytes]] = {}
        self._lock = Lock()
        self.max_bytes = max_bytes
        self.max_pixels = max_pixels

    def create_upload(self, asset: MediaAsset, *, expires_in: int) -> UploadTarget:
        del expires_in
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._tokens[asset.id] = token
        return UploadTarget(
            url=(
                f"/api/v1/media/uploads/{quote(asset.id, safe='')}/content"
                f"?token={quote(token, safe='')}"
            ),
            headers={"Content-Type": asset.content_type},
        )

    def put_development_content(
        self,
        asset: MediaAsset,
        *,
        token: str,
        content_type: str,
        payload: bytes,
    ) -> None:
        with self._lock:
            expected_token = self._tokens.get(asset.id)
        if expected_token is None or not secrets.compare_digest(expected_token, token):
            raise MediaStorageError("invalid or expired development upload token")
        if content_type != asset.content_type:
            raise InvalidUploadedImage("upload content type does not match the ticket")
        if len(payload) != asset.byte_size:
            raise InvalidUploadedImage("upload byte size does not match the ticket")
        validate_image_signature(content_type, payload[:16])
        with self._lock:
            self._objects[asset.id] = (content_type, payload)

    def verify_upload(self, asset: MediaAsset) -> UploadedObject:
        with self._lock:
            stored = self._objects.get(asset.id)
        if stored is None:
            raise StorageObjectMissing("uploaded object was not found")
        content_type, payload = stored
        validate_image_signature(content_type, payload[:16])
        return UploadedObject(
            content_type=content_type,
            byte_size=len(payload),
            checksum_sha256=hashlib.sha256(payload).hexdigest(),
        )

    def sanitize_upload(self, asset: MediaAsset) -> SanitizedObject:
        with self._lock:
            stored = self._objects.get(asset.id)
        if stored is None:
            raise StorageObjectMissing("uploaded object was not found")
        content_type, payload = stored
        sanitized_bytes, sanitized = sanitize_image(
            content_type,
            payload,
            max_bytes=self.max_bytes,
            max_pixels=self.max_pixels,
            object_key=_final_object_key(asset),
        )
        with self._lock:
            self._tokens.pop(asset.id, None)
            self._objects[asset.id] = (content_type, sanitized_bytes)
        return sanitized

    def delete(self, asset: MediaAsset) -> None:
        with self._lock:
            self._tokens.pop(asset.id, None)
            self._objects.pop(asset.id, None)

    def read_development_content(self, asset_id: str) -> bytes | None:
        with self._lock:
            stored = self._objects.get(asset_id)
        return stored[1] if stored else None


class S3MediaStorage(MediaStorage):
    def __init__(self, settings: Settings) -> None:
        secret = settings.object_storage_secret_access_key
        if (
            not settings.object_storage_bucket
            or not settings.object_storage_access_key_id
            or secret is None
            or not settings.object_storage_public_base_url
        ):
            raise ValueError("object storage settings are incomplete")
        self.bucket = settings.object_storage_bucket
        self.public_base_url = settings.object_storage_public_base_url.rstrip("/")
        self.max_bytes = settings.media_upload_max_bytes
        self.max_pixels = settings.media_max_image_pixels
        addressing_style = "path" if settings.object_storage_force_path_style else "virtual"
        self.client: Any = boto3.client(
            "s3",
            endpoint_url=settings.object_storage_endpoint,
            region_name=settings.object_storage_region,
            aws_access_key_id=settings.object_storage_access_key_id,
            aws_secret_access_key=secret.get_secret_value(),
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": addressing_style},
            ),
        )

    def create_upload(self, asset: MediaAsset, *, expires_in: int) -> UploadTarget:
        try:
            upload_url = self.client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": asset.object_key,
                    "ContentType": asset.content_type,
                },
                ExpiresIn=expires_in,
                HttpMethod="PUT",
            )
        except (BotoCoreError, ClientError) as exc:
            raise MediaStorageError("could not create an object upload URL") from exc
        return UploadTarget(
            url=upload_url,
            headers={"Content-Type": asset.content_type},
        )

    def verify_upload(self, asset: MediaAsset) -> UploadedObject:
        try:
            metadata = self.client.head_object(
                Bucket=self.bucket,
                Key=asset.object_key,
            )
            prefix_response = self.client.get_object(
                Bucket=self.bucket,
                Key=asset.object_key,
                Range="bytes=0-15",
            )
            prefix = prefix_response["Body"].read(16)
        except (BotoCoreError, ClientError, KeyError) as exc:
            raise StorageObjectMissing("uploaded object was not found") from exc
        content_type = str(metadata.get("ContentType") or "")
        byte_size = int(metadata.get("ContentLength") or 0)
        validate_image_signature(content_type, prefix)
        return UploadedObject(
            content_type=content_type,
            byte_size=byte_size,
            checksum_sha256=None,
        )

    def sanitize_upload(self, asset: MediaAsset) -> SanitizedObject:
        try:
            response = self.client.get_object(
                Bucket=self.bucket,
                Key=asset.object_key,
            )
            payload = response["Body"].read(self.max_bytes + 1)
        except (BotoCoreError, ClientError, KeyError) as exc:
            raise StorageObjectMissing("uploaded object was not found") from exc
        if len(payload) > self.max_bytes:
            raise InvalidUploadedImage("uploaded object exceeds the size limit")

        final_key = _final_object_key(asset)
        sanitized_bytes, sanitized = sanitize_image(
            asset.content_type,
            payload,
            max_bytes=self.max_bytes,
            max_pixels=self.max_pixels,
            object_key=final_key,
        )
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=final_key,
                Body=sanitized_bytes,
                ContentType=asset.content_type,
                CacheControl="public, max-age=31536000, immutable",
            )
        except (BotoCoreError, ClientError) as exc:
            raise MediaStorageError("could not finalize the uploaded image") from exc
        if final_key != asset.object_key:
            try:
                self.client.delete_object(
                    Bucket=self.bucket,
                    Key=asset.object_key,
                )
            except BotoCoreError, ClientError:
                # A lifecycle rule on the private pending/ prefix removes any
                # raw object left behind after the verified copy succeeds.
                pass
        return sanitized

    def delete(self, asset: MediaAsset) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=asset.object_key)
        except (BotoCoreError, ClientError) as exc:
            raise MediaStorageError("could not delete the stored object") from exc


def build_media_storage(settings: Settings) -> MediaStorage:
    if settings.app_env in {"development", "test"}:
        return DevelopmentMediaStorage(
            max_bytes=settings.media_upload_max_bytes,
            max_pixels=settings.media_max_image_pixels,
        )
    if not settings.media_uploads_enabled:
        return DevelopmentMediaStorage(
            max_bytes=settings.media_upload_max_bytes,
            max_pixels=settings.media_max_image_pixels,
        )
    return S3MediaStorage(settings)


def public_media_url(asset: MediaAsset, settings: Settings) -> str:
    if settings.app_env in {"development", "test"}:
        return f"/api/v1/media/assets/{quote(asset.id, safe='')}/content"
    if not settings.object_storage_public_base_url:
        raise ValueError("OBJECT_STORAGE_PUBLIC_BASE_URL is not configured")
    return (
        f"{settings.object_storage_public_base_url.rstrip('/')}/{quote(asset.object_key, safe='/')}"
    )
