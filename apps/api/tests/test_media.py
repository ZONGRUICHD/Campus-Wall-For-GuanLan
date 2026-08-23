from datetime import timedelta
from io import BytesIO

import pytest
from PIL import Image

from campus_wall_api.media_storage import InvalidUploadedImage, sanitize_image
from campus_wall_api.models import MediaAsset, utc_now


def image_bytes(
    image_format: str,
    *,
    size: tuple[int, int] = (4, 3),
    include_exif: bool = False,
) -> bytes:
    image = Image.new("RGB", size, (45, 112, 90))
    output = BytesIO()
    options: dict[str, object] = {}
    if include_exif:
        exif = Image.Exif()
        exif[0x010E] = "private-campus-location"
        exif[0x0112] = 6
        options["exif"] = exif
    image.save(output, format=image_format, **options)
    return output.getvalue()


PNG_BYTES = image_bytes("PNG")
JPEG_WITH_EXIF = image_bytes("JPEG", size=(3, 5), include_exif=True)


def register_and_login(api, username: str) -> dict[str, str]:
    registered = api.client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "password": "Student2026",
            "display_name": f"{username}同学",
        },
    )
    assert registered.status_code == 201, registered.text
    login = api.client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "Student2026"},
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def create_upload(
    api,
    headers: dict[str, str],
    *,
    file_name: str = "campus.png",
    content_type: str = "image/png",
    payload: bytes = PNG_BYTES,
):
    response = api.client.post(
        "/api/v1/media/uploads",
        headers=headers,
        json={
            "file_name": file_name,
            "content_type": content_type,
            "byte_size": len(payload),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def upload_and_complete(
    api,
    headers: dict[str, str],
    *,
    file_name: str = "campus.png",
    content_type: str = "image/png",
    payload: bytes = PNG_BYTES,
):
    ticket = create_upload(
        api,
        headers,
        file_name=file_name,
        content_type=content_type,
        payload=payload,
    )
    uploaded = api.client.put(
        ticket["upload_url"],
        content=payload,
        headers=ticket["upload_headers"],
    )
    assert uploaded.status_code == 204, uploaded.text
    completed = api.client.post(
        f"/api/v1/media/uploads/{ticket['media_id']}/complete",
        headers=headers,
    )
    assert completed.status_code == 200, completed.text
    completed_payload = completed.json()
    assert completed_payload["media_id"] == ticket["media_id"]
    assert completed_payload["status"] == "ready"
    assert completed_payload["content_type"] == content_type
    assert completed_payload["byte_size"] > 0
    assert completed_payload["pixel_width"] > 0
    assert completed_payload["pixel_height"] > 0
    ticket["_completed"] = completed_payload
    return ticket


def test_image_upload_attach_read_and_remove_lifecycle(api):
    owner = api.client.get("/api/v1/auth/me", headers=api.auth_headers).json()
    ticket = upload_and_complete(
        api,
        api.auth_headers,
        file_name="../校园 风景.png",
    )
    assert ticket["object_key"].startswith(f"pending/{owner['id']}/")
    assert ticket["object_key"].endswith(".png")

    with api.session_factory() as session, session.begin():
        asset = session.get(MediaAsset, ticket["media_id"])
        assert asset is not None
        assert asset.original_name == "校园 风景.png"
        assert asset.object_key.startswith(f"posts/{owner['id']}/")
        assert asset.checksum_sha256 is not None
        assert (asset.pixel_width, asset.pixel_height) == (4, 3)
        sanitized_size = asset.byte_size

    created = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": "带图片的校园日常",
            "body": "验证图片直传、绑定、读取和移除。",
            "board": "daily",
            "media_ids": [ticket["media_id"]],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["media"] == [
        {
            "id": ticket["media_id"],
            "url": f"/api/v1/media/assets/{ticket['media_id']}/content",
            "content_type": "image/png",
            "byte_size": sanitized_size,
            "pixel_width": 4,
            "pixel_height": 3,
            "position": 0,
        }
    ]

    image = api.client.get(created.json()["media"][0]["url"])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers["x-content-type-options"] == "nosniff"
    with Image.open(BytesIO(image.content)) as decoded:
        assert decoded.size == (4, 3)
        assert not decoded.getexif()

    feed_post = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "带图片的校园日常"},
    ).json()["items"][0]
    assert feed_post["media"] == created.json()["media"]

    attached_delete = api.client.delete(
        f"/api/v1/media/uploads/{ticket['media_id']}",
        headers=api.auth_headers,
    )
    assert attached_delete.status_code == 409
    assert attached_delete.json()["detail"]["code"] == "media_already_attached"

    other_headers = register_and_login(api, "media_other")
    cross_user = api.client.post(
        "/api/v1/posts",
        headers=other_headers,
        json={
            "title": "不能盗用图片",
            "body": "其他用户不能绑定不属于自己的对象。",
            "board": "daily",
            "media_ids": [ticket["media_id"]],
        },
    )
    assert cross_user.status_code == 422
    assert cross_user.json()["detail"]["code"] == "media_unavailable"

    removed = api.client.patch(
        f"/api/v1/posts/{created.json()['id']}",
        headers=api.auth_headers,
        json={"media_ids": []},
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["media"] == []
    assert api.client.get(created.json()["media"][0]["url"]).status_code == 404

    with api.session_factory() as session, session.begin():
        asset = session.get(MediaAsset, ticket["media_id"])
        assert asset is not None
        assert asset.status == "deleted"
    assert api.media_storage.read_development_content(ticket["media_id"]) is None


def test_upload_validation_missing_object_expiry_and_unattached_delete(api):
    assert (
        api.client.post(
            "/api/v1/media/uploads",
            headers=api.auth_headers,
            json={
                "file_name": "unsafe.svg",
                "content_type": "image/svg+xml",
                "byte_size": 100,
            },
        ).status_code
        == 422
    )
    too_large = api.client.post(
        "/api/v1/media/uploads",
        headers=api.auth_headers,
        json={
            "file_name": "huge.png",
            "content_type": "image/png",
            "byte_size": 9 * 1024 * 1024,
        },
    )
    assert too_large.status_code == 413
    assert too_large.json()["detail"]["code"] == "media_too_large"

    missing = create_upload(api, api.auth_headers)
    missing_complete = api.client.post(
        f"/api/v1/media/uploads/{missing['media_id']}/complete",
        headers=api.auth_headers,
    )
    assert missing_complete.status_code == 409
    assert missing_complete.json()["detail"]["code"] == "media_upload_missing"

    invalid = create_upload(api, api.auth_headers)
    invalid_bytes = b"not-an-image".ljust(len(PNG_BYTES), b"x")
    invalid_upload = api.client.put(
        invalid["upload_url"],
        content=invalid_bytes,
        headers=invalid["upload_headers"],
    )
    assert invalid_upload.status_code == 422
    assert invalid_upload.json()["detail"]["code"] == "invalid_uploaded_image"

    malformed_payload = b"\x89PNG\r\n\x1a\n" + b"not-a-decodable-png"
    malformed = create_upload(
        api,
        api.auth_headers,
        payload=malformed_payload,
    )
    malformed_upload = api.client.put(
        malformed["upload_url"],
        content=malformed_payload,
        headers=malformed["upload_headers"],
    )
    assert malformed_upload.status_code == 204
    malformed_complete = api.client.post(
        f"/api/v1/media/uploads/{malformed['media_id']}/complete",
        headers=api.auth_headers,
    )
    assert malformed_complete.status_code == 422
    assert malformed_complete.json()["detail"]["code"] == "invalid_uploaded_image"
    assert api.media_storage.read_development_content(malformed["media_id"]) is None

    expired = create_upload(api, api.auth_headers)
    with api.session_factory() as session, session.begin():
        asset = session.get(MediaAsset, expired["media_id"])
        assert asset is not None
        asset.expires_at = utc_now() - timedelta(seconds=1)
    expired_complete = api.client.post(
        f"/api/v1/media/uploads/{expired['media_id']}/complete",
        headers=api.auth_headers,
    )
    assert expired_complete.status_code == 410
    with api.session_factory() as session, session.begin():
        expired_asset = session.get(MediaAsset, expired["media_id"])
        assert expired_asset is not None
        assert expired_asset.status == "deleted"

    deletable = upload_and_complete(api, api.auth_headers, file_name="remove.webp.png")
    deleted = api.client.delete(
        f"/api/v1/media/uploads/{deletable['media_id']}",
        headers=api.auth_headers,
    )
    assert deleted.status_code == 204
    assert api.media_storage.read_development_content(deletable["media_id"]) is None


def test_duplicate_media_ids_and_attachment_limit_are_rejected(api):
    ticket = upload_and_complete(api, api.auth_headers)
    duplicate = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": "重复图片",
            "body": "同一个媒体对象不能在帖子内重复。",
            "board": "daily",
            "media_ids": [ticket["media_id"], ticket["media_id"]],
        },
    )
    assert duplicate.status_code == 422

    tickets = [ticket] + [
        upload_and_complete(
            api,
            api.auth_headers,
            file_name=f"limit-{index}.png",
        )
        for index in range(6)
    ]
    too_many = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": "图片数量超限",
            "body": "每张帖子最多附带六张图片。",
            "board": "daily",
            "media_ids": [item["media_id"] for item in tickets],
        },
    )
    assert too_many.status_code == 422
    assert too_many.json()["detail"]["code"] == "too_many_media"


def test_uploaded_jpeg_is_reencoded_without_exif(api):
    ticket = upload_and_complete(
        api,
        api.auth_headers,
        file_name="campus-with-location.jpg",
        content_type="image/jpeg",
        payload=JPEG_WITH_EXIF,
    )
    completed = ticket["_completed"]
    assert (completed["pixel_width"], completed["pixel_height"]) == (5, 3)

    image = api.client.get(
        f"/api/v1/media/assets/{ticket['media_id']}/content",
    )
    assert image.status_code == 200
    assert b"private-campus-location" not in image.content
    with Image.open(BytesIO(image.content)) as decoded:
        assert decoded.size == (5, 3)
        assert not decoded.getexif()


def test_image_pixel_limit_is_enforced_during_decode():
    with pytest.raises(InvalidUploadedImage, match="pixel limit"):
        sanitize_image(
            "image/png",
            PNG_BYTES,
            max_bytes=1024 * 1024,
            max_pixels=11,
            object_key="posts/test/image.png",
        )
