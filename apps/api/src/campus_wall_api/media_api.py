from collections.abc import Iterator
from datetime import timedelta
from pathlib import PurePath
from typing import Annotated
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import audit_event
from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.config import Settings
from campus_wall_api.database import session_dependency
from campus_wall_api.media_schemas import (
    MediaUploadCompleteRead,
    MediaUploadCreate,
    MediaUploadTicket,
)
from campus_wall_api.media_storage import (
    InvalidUploadedImage,
    MediaStorage,
    MediaStorageError,
    StorageObjectMissing,
)
from campus_wall_api.models import MediaAsset, PostMedia, utc_now

CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def _require_media_permission(identity: CurrentIdentity) -> None:
    if identity.user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "password_change_required",
                "message": "change the initial password before uploading media",
            },
        )
    if "content:create" not in identity.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "permission denied"},
        )


def create_media_router(
    session_factory: sessionmaker[Session],
    identity_provider: IdentityProvider,
    settings: Settings,
    storage: MediaStorage,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1/media", tags=["media"])

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]
    IdentityDependency = Annotated[CurrentIdentity, Depends(identity_provider)]

    @router.post(
        "/uploads",
        response_model=MediaUploadTicket,
        status_code=status.HTTP_201_CREATED,
    )
    def create_upload(
        payload: MediaUploadCreate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> MediaUploadTicket:
        _require_media_permission(identity)
        if not settings.media_uploads_active:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "media_uploads_disabled",
                    "message": "media uploads are not enabled",
                },
            )
        if payload.byte_size > settings.media_upload_max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail={
                    "code": "media_too_large",
                    "message": (f"images must not exceed {settings.media_upload_max_bytes} bytes"),
                },
            )

        now = utc_now()
        with session.begin():
            recent_uploads = int(
                session.scalar(
                    select(func.count(MediaAsset.id)).where(
                        MediaAsset.owner_user_id == identity.user.id,
                        MediaAsset.created_at >= now - timedelta(minutes=1),
                    )
                )
                or 0
            )
            if recent_uploads >= settings.media_uploads_per_minute:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "code": "media_upload_rate_limited",
                        "message": "too many media uploads; wait before trying again",
                    },
                )

            media_id = str(uuid4())
            extension = CONTENT_TYPE_EXTENSIONS[payload.content_type]
            original_name = PurePath(payload.file_name).name[:255]
            asset = MediaAsset(
                id=media_id,
                owner_user_id=identity.user.id,
                object_key=f"pending/{identity.user.id}/{media_id}.{extension}",
                original_name=original_name,
                content_type=payload.content_type,
                byte_size=payload.byte_size,
                expires_at=now + timedelta(seconds=settings.media_upload_ttl_seconds),
            )
            session.add(asset)
            session.flush()
            try:
                target = storage.create_upload(
                    asset,
                    expires_in=settings.media_upload_ttl_seconds,
                )
            except MediaStorageError as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={
                        "code": "media_storage_unavailable",
                        "message": str(exc),
                    },
                ) from exc
            audit_event(
                session,
                action="media.upload_created",
                target_type="media_asset",
                target_id=asset.id,
                actor_user_id=identity.user.id,
                details={
                    "content_type": asset.content_type,
                    "byte_size": asset.byte_size,
                },
            )
            return MediaUploadTicket(
                media_id=asset.id,
                object_key=asset.object_key,
                upload_url=target.url,
                upload_headers=target.headers,
                expires_at=asset.expires_at,
            )

    @router.put(
        "/uploads/{media_id}/content",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def upload_development_content(
        media_id: str,
        request: Request,
        session: SessionDependency,
        token: Annotated[str, Query(min_length=20, max_length=200)],
        content_type: Annotated[str | None, Header()] = None,
    ) -> Response:
        if settings.app_env not in {"development", "test"}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        with session.begin():
            asset = session.get(MediaAsset, media_id)
            if asset is None or asset.status != "pending":
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if asset.expires_at < utc_now():
                raise HTTPException(
                    status_code=status.HTTP_410_GONE,
                    detail={
                        "code": "upload_ticket_expired",
                        "message": "the media upload ticket has expired",
                    },
                )
            if content_type != asset.content_type:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "media_type_mismatch",
                        "message": "upload content type does not match the ticket",
                    },
                )
            body = await request.body()
            if len(body) > settings.media_upload_max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail={"code": "media_too_large"},
                )
            try:
                storage.put_development_content(
                    asset,
                    token=token,
                    content_type=content_type,
                    payload=body,
                )
            except (InvalidUploadedImage, MediaStorageError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "invalid_uploaded_image",
                        "message": str(exc),
                    },
                ) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post(
        "/uploads/{media_id}/complete",
        response_model=MediaUploadCompleteRead,
    )
    def complete_upload(
        media_id: str,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> MediaUploadCompleteRead:
        _require_media_permission(identity)
        error: HTTPException | None = None
        result: MediaUploadCompleteRead | None = None
        cleanup_asset: MediaAsset | None = None
        with session.begin():
            asset = session.scalar(
                select(MediaAsset).where(MediaAsset.id == media_id).with_for_update()
            )
            if asset is None or asset.owner_user_id != identity.user.id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if asset.status == "ready":
                return MediaUploadCompleteRead(
                    media_id=asset.id,
                    status="ready",
                    content_type=asset.content_type,
                    byte_size=asset.byte_size,
                    pixel_width=asset.pixel_width,
                    pixel_height=asset.pixel_height,
                )
            if asset.status != "pending":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "media_upload_not_pending",
                        "message": "this media upload cannot be completed",
                    },
                )
            if asset.expires_at < utc_now():
                asset.status = "deleted"
                cleanup_asset = asset
                error = HTTPException(
                    status_code=status.HTTP_410_GONE,
                    detail={
                        "code": "upload_ticket_expired",
                        "message": "the media upload ticket has expired",
                    },
                )
            else:
                try:
                    uploaded = storage.verify_upload(asset)
                except StorageObjectMissing as exc:
                    error = HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "code": "media_upload_missing",
                            "message": str(exc),
                        },
                    )
                except (InvalidUploadedImage, MediaStorageError) as exc:
                    asset.status = "rejected"
                    cleanup_asset = asset
                    error = HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={
                            "code": "invalid_uploaded_image",
                            "message": str(exc),
                        },
                    )
                else:
                    if (
                        uploaded.content_type != asset.content_type
                        or uploaded.byte_size != asset.byte_size
                    ):
                        asset.status = "rejected"
                        cleanup_asset = asset
                        error = HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                            detail={
                                "code": "media_metadata_mismatch",
                                "message": (
                                    "uploaded content type or byte size does not match the ticket"
                                ),
                            },
                        )
                    else:
                        try:
                            sanitized = storage.sanitize_upload(asset)
                        except (InvalidUploadedImage, MediaStorageError) as exc:
                            asset.status = "rejected"
                            cleanup_asset = asset
                            error = HTTPException(
                                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                                detail={
                                    "code": "invalid_uploaded_image",
                                    "message": str(exc),
                                },
                            )
                        else:
                            now = utc_now()
                            asset.object_key = sanitized.object_key
                            asset.content_type = sanitized.content_type
                            asset.byte_size = sanitized.byte_size
                            asset.pixel_width = sanitized.pixel_width
                            asset.pixel_height = sanitized.pixel_height
                            asset.status = "ready"
                            asset.checksum_sha256 = sanitized.checksum_sha256
                            asset.uploaded_at = now
                            asset.updated_at = now
                            audit_event(
                                session,
                                action="media.upload_completed",
                                target_type="media_asset",
                                target_id=asset.id,
                                actor_user_id=identity.user.id,
                                details={
                                    "pixel_width": asset.pixel_width,
                                    "pixel_height": asset.pixel_height,
                                    "sanitized": True,
                                },
                            )
                            result = MediaUploadCompleteRead(
                                media_id=asset.id,
                                status="ready",
                                content_type=asset.content_type,
                                byte_size=asset.byte_size,
                                pixel_width=asset.pixel_width,
                                pixel_height=asset.pixel_height,
                            )
        if cleanup_asset is not None:
            try:
                storage.delete(cleanup_asset)
            except MediaStorageError:
                pass
        if error is not None:
            raise error
        if result is None:
            raise RuntimeError("media upload completion produced no result")
        return result

    @router.delete(
        "/uploads/{media_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def delete_upload(
        media_id: str,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> Response:
        _require_media_permission(identity)
        with session.begin():
            asset = session.scalar(
                select(MediaAsset).where(MediaAsset.id == media_id).with_for_update()
            )
            if asset is None or asset.owner_user_id != identity.user.id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if session.scalar(
                select(PostMedia.post_id).where(PostMedia.media_asset_id == asset.id)
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "media_already_attached",
                        "message": "attached media must be removed from the post first",
                    },
                )
            storage.delete(asset)
            asset.status = "deleted"
            asset.updated_at = utc_now()
            audit_event(
                session,
                action="media.upload_deleted",
                target_type="media_asset",
                target_id=asset.id,
                actor_user_id=identity.user.id,
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/assets/{media_id}/content")
    def get_development_content(
        media_id: str,
        session: SessionDependency,
    ) -> Response:
        if settings.app_env not in {"development", "test"}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        with session.begin():
            asset = session.scalar(
                select(MediaAsset).where(
                    MediaAsset.id == media_id,
                    MediaAsset.status == "ready",
                )
            )
            if asset is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            body = storage.read_development_content(asset.id)
            if body is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            content_type = asset.content_type
        return Response(
            content=body,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    return router
