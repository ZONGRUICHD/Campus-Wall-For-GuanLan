from datetime import timedelta

from sqlalchemy import select

from campus_wall_api.config import DEVELOPMENT_CRON_SECRET
from campus_wall_api.models import Post, utc_now


def create_post(api, **overrides):
    payload = {
        "title": "生命周期测试",
        "body": "草稿、发布、编辑和删除应当遵循作者权限。",
        "board": "daily",
        **overrides,
    }
    response = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


def register_and_login(api, username: str) -> dict[str, str]:
    registered = api.client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "password": "Student2026",
            "display_name": f"{username}同学",
            "email": f"{username}@example.edu",
        },
    )
    assert registered.status_code == 201, registered.text
    login = api.client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "Student2026"},
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_draft_edit_publish_and_soft_delete_lifecycle(api):
    draft = create_post(api, publication_status="draft")

    public_before = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "生命周期测试"},
    )
    mine = api.client.get("/api/v1/posts/me", headers=api.auth_headers)
    assert public_before.json()["items"] == []
    assert mine.json()["items"][0]["id"] == draft["id"]
    assert mine.json()["items"][0]["publication_status"] == "draft"
    assert mine.json()["items"][0]["can_edit"] is True

    published = api.client.patch(
        f"/api/v1/posts/{draft['id']}",
        headers=api.auth_headers,
        json={
            "title": "生命周期测试（已发布）",
            "publication_status": "published",
            "comments_enabled": False,
        },
    )
    assert published.status_code == 200, published.text
    assert published.json()["publication_status"] == "published"
    assert published.json()["edited_at"] is not None
    assert published.json()["comments_enabled"] is False

    visible = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "生命周期测试（已发布）"},
    )
    assert [item["id"] for item in visible.json()["items"]] == [draft["id"]]
    assert (
        api.client.post(
            f"/api/v1/posts/{draft['id']}/comments",
            headers=api.auth_headers,
            json={"body": "关闭评论后不能回复"},
        ).status_code
        == 404
    )

    deleted = api.client.delete(
        f"/api/v1/posts/{draft['id']}",
        headers=api.auth_headers,
    )
    assert deleted.status_code == 204
    assert (
        api.client.get(
            "/api/v1/posts",
            headers=api.auth_headers,
            params={"query": "生命周期测试（已发布）"},
        ).json()["items"]
        == []
    )


def test_scheduled_post_is_published_only_by_authenticated_cron(api):
    future = utc_now() + timedelta(hours=1)
    scheduled = create_post(
        api,
        title="定时发布测试",
        publication_status="scheduled",
        scheduled_for=future.isoformat(),
    )
    assert scheduled["publication_status"] == "scheduled"
    assert (
        api.client.get(
            "/api/v1/posts",
            headers=api.auth_headers,
            params={"query": "定时发布测试"},
        ).json()["items"]
        == []
    )
    assert api.client.get("/api/v1/internal/publish-due").status_code == 401

    with api.session_factory() as session, session.begin():
        post = session.scalar(select(Post).where(Post.id == scheduled["id"]))
        assert post is not None
        post.scheduled_for = utc_now() - timedelta(seconds=1)

    published = api.client.get(
        "/api/v1/internal/publish-due",
        headers={"Authorization": f"Bearer {DEVELOPMENT_CRON_SECRET}"},
    )
    assert published.status_code == 200
    assert published.json() == {"published": 1}
    assert [
        item["id"]
        for item in api.client.get(
            "/api/v1/posts",
            headers=api.auth_headers,
            params={"query": "定时发布测试"},
        ).json()["items"]
    ] == [scheduled["id"]]


def test_bookmarks_are_private_per_user_and_toggle(api):
    post = create_post(api, title="收藏测试")

    bookmarked = api.client.post(
        f"/api/v1/posts/{post['id']}/bookmark",
        headers=api.auth_headers,
    )
    listed = api.client.get("/api/v1/bookmarks", headers=api.auth_headers)
    unbookmarked = api.client.post(
        f"/api/v1/posts/{post['id']}/bookmark",
        headers=api.auth_headers,
    )

    assert bookmarked.json() == {"post_id": post["id"], "bookmarked": True}
    assert listed.json()["items"][0]["id"] == post["id"]
    assert listed.json()["items"][0]["bookmarked"] is True
    assert unbookmarked.json() == {"post_id": post["id"], "bookmarked": False}
    assert (
        api.client.get(
            "/api/v1/bookmarks",
            headers=api.auth_headers,
        ).json()["items"]
        == []
    )


def test_threaded_comments_edits_reactions_and_depth_limit(api):
    post = create_post(api, title="楼中楼测试")

    root = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        headers=api.auth_headers,
        json={"body": "一级评论"},
    )
    reply = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        headers=api.auth_headers,
        json={"body": "二级回复", "parent_id": root.json()["id"]},
    )
    nested = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        headers=api.auth_headers,
        json={"body": "三级回复", "parent_id": reply.json()["id"]},
    )
    too_deep = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        headers=api.auth_headers,
        json={"body": "超过深度", "parent_id": nested.json()["id"]},
    )

    assert root.json()["depth"] == 0
    assert root.json()["can_edit"] is True
    assert reply.json()["depth"] == 1
    assert reply.json()["can_edit"] is True
    assert nested.json()["depth"] == 2
    assert too_deep.status_code == 422

    liked = api.client.post(
        f"/api/v1/comments/{reply.json()['id']}/reactions",
        headers=api.auth_headers,
    )
    edited = api.client.patch(
        f"/api/v1/comments/{reply.json()['id']}",
        headers=api.auth_headers,
        json={"body": "二级回复（已编辑）"},
    )
    assert liked.json() == {
        "comment_id": reply.json()["id"],
        "reaction_count": 1,
        "liked": True,
    }
    assert edited.status_code == 200
    assert edited.json()["edited_at"] is not None

    feed = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "楼中楼测试"},
    ).json()["items"][0]
    persisted_reply = next(
        comment for comment in feed["comments"] if comment["id"] == reply.json()["id"]
    )
    assert persisted_reply["body"] == "二级回复（已编辑）"
    assert persisted_reply["reaction_count"] == 1
    assert persisted_reply["liked"] is True
    assert persisted_reply["can_edit"] is True
    my_post = next(
        item
        for item in api.client.get(
            "/api/v1/posts/me",
            headers=api.auth_headers,
        ).json()["items"]
        if item["id"] == post["id"]
    )
    assert my_post["comment_count"] == 3

    assert (
        api.client.delete(
            f"/api/v1/comments/{reply.json()['id']}",
            headers=api.auth_headers,
        ).status_code
        == 204
    )


def test_edit_capability_is_scoped_to_the_content_author(api):
    post = create_post(api, title="编辑权限标记测试")
    comment = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        headers=api.auth_headers,
        json={"body": "作者自己的评论"},
    ).json()
    viewer_headers = register_and_login(api, "content_viewer")

    viewer_feed = api.client.get(
        "/api/v1/posts",
        headers=viewer_headers,
        params={"query": "编辑权限标记测试"},
    )
    assert viewer_feed.status_code == 200, viewer_feed.text
    viewer_post = viewer_feed.json()["items"][0]
    viewer_comment = next(
        item for item in viewer_post["comments"] if item["id"] == comment["id"]
    )
    assert viewer_post["can_edit"] is False
    assert viewer_comment["can_edit"] is False

    own_comment = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        headers=viewer_headers,
        json={"body": "查看者自己的评论"},
    )
    assert own_comment.status_code == 201, own_comment.text
    assert own_comment.json()["can_edit"] is True
    assert (
        api.client.patch(
            f"/api/v1/posts/{post['id']}",
            headers=viewer_headers,
            json={"title": "越权编辑"},
        ).status_code
        == 403
    )
