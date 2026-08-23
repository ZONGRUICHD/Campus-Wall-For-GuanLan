import hashlib
import secrets
from dataclasses import dataclass
from threading import Lock
from typing import Any
from urllib.parse import quote

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

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


def validate_image_signature(content_type: str, prefix: bytes) -> None:
    valid = (
        content_type == "image/jpeg"
        and prefix.startswith(b"\xff\xd8\xff")
        or content_type == "image/png"
        and prefix.startswith(b"\x89PNG\r\n\x1a\n")
        or content_type == "image/webp"
        and prefix.startswith(b"RIFF")
        and prefix[8:12] == b"WEBP"
    )
    if not valid:
        raise InvalidUploadedImage("uploaded bytes do not match the declared image type")


class MediaStorage:
    def create_upload(self, asset: MediaAsset, *, expires_in: int) -> UploadTarget:
        raise NotImplementedError

    def verify_upload(self, asset: MediaAsset) -> UploadedObject:
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
    def __init__(self) -> None:
        self._tokens: dict[str, str] = {}
        self._objects: dict[str, tuple[str, bytes]] = {}
        self._lock = Lock()

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
        addressing_style = (
            "path" if settings.object_storage_force_path_style else "virtual"
        )
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

    def delete(self, asset: MediaAsset) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=asset.object_key)
        except (BotoCoreError, ClientError) as exc:
            raise MediaStorageError("could not delete the stored object") from exc


def build_media_storage(settings: Settings) -> MediaStorage:
    if settings.app_env in {"development", "test"}:
        return DevelopmentMediaStorage()
    if not settings.media_uploads_enabled:
        return DevelopmentMediaStorage()
    return S3MediaStorage(settings)


def public_media_url(asset: MediaAsset, settings: Settings) -> str:
    if settings.app_env in {"development", "test"}:
        return f"/api/v1/media/assets/{quote(asset.id, safe='')}/content"
    if not settings.object_storage_public_base_url:
        raise ValueError("OBJECT_STORAGE_PUBLIC_BASE_URL is not configured")
    return (
        f"{settings.object_storage_public_base_url.rstrip('/')}/"
        f"{quote(asset.object_key, safe='/')}"
    )
