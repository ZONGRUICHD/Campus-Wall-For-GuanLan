from campus_wall_api.config import DEVELOPMENT_CRON_SECRET


def register_and_login(api, username: str, display_name: str) -> tuple[dict[str, str], str]:
    registered = api.client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "password": "Discovery2026",
            "display_name": display_name,
        },
    )
    assert registered.status_code == 201, registered.text
    login = api.client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "Discovery2026"},
    )
    assert login.status_code == 200, login.text
    return (
        {"Authorization": f"Bearer {login.json()['access_token']}"},
        registered.json()["id"],
    )


def create_post(api, *, anonymous: bool = False, title: str | None = None) -> dict:
    response = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "board": "daily",
            "title": title,
            "body": ("这是一条用于验证全局搜索、关注动态和订阅通知的校园编程活动信息。"),
            "anonymous": anonymous,
            "tags": ["编程", "社团活动"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_follow_interaction_notifications_and_outbox(api):
    follower_headers, follower_id = register_and_login(
        api,
        "discovery_follower",
        "发现功能同学",
    )
    author_id = api.client.get(
        "/api/v1/users/me/profile",
        headers=api.auth_headers,
    ).json()["id"]
    post = create_post(api, title="通知闭环测试")

    followed = api.client.put(
        f"/api/v1/users/{author_id}/follow",
        headers=follower_headers,
    )
    assert followed.status_code == 200, followed.text
    assert followed.json()["following"] is True

    notifications = api.client.get(
        "/api/v1/notifications",
        headers=api.auth_headers,
    )
    assert notifications.status_code == 200, notifications.text
    follow_notification = notifications.json()["items"][0]
    assert follow_notification["type"] == "follow"
    assert follow_notification["actor_user_id"] == follower_id
    assert follow_notification["actor_name"] == "发现功能同学"

    unread = api.client.get(
        "/api/v1/notifications/unread-count",
        headers=api.auth_headers,
    )
    assert unread.json() == {"unread_count": 1}
    marked = api.client.post(
        "/api/v1/notifications/read",
        headers=api.auth_headers,
        json={"ids": [follow_notification["id"]]},
    )
    assert marked.status_code == 200
    assert marked.json() == {"unread_count": 0}

    liked = api.client.post(
        f"/api/v1/posts/{post['id']}/reactions",
        headers=follower_headers,
    )
    assert liked.status_code == 200
    assert liked.json()["liked"] is True
    assert (
        api.client.get(
            "/api/v1/notifications/unread-count",
            headers=api.auth_headers,
        ).json()["unread_count"]
        == 1
    )

    unliked = api.client.post(
        f"/api/v1/posts/{post['id']}/reactions",
        headers=follower_headers,
    )
    assert unliked.status_code == 200
    assert unliked.json()["liked"] is False
    assert (
        api.client.get(
            "/api/v1/notifications/unread-count",
            headers=api.auth_headers,
        ).json()["unread_count"]
        == 0
    )

    comment = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        headers=follower_headers,
        json={"body": "匿名评论只应显示匿名昵称，不能暴露真实账号。", "anonymous": True},
    )
    assert comment.status_code == 201, comment.text
    comment_notification = api.client.get(
        "/api/v1/notifications",
        headers=api.auth_headers,
        params={"unread_only": "true"},
    ).json()["items"][0]
    assert comment_notification["type"] == "comment"
    assert comment_notification["actor_name"] == "匿名同学"
    assert comment_notification["actor_user_id"] is None

    cannot_read_someone_elses = api.client.post(
        "/api/v1/notifications/read",
        headers=follower_headers,
        json={"ids": [comment_notification["id"]]},
    )
    assert cannot_read_someone_elses.status_code == 200
    assert cannot_read_someone_elses.json()["unread_count"] == 0
    assert (
        api.client.get(
            "/api/v1/notifications/unread-count",
            headers=api.auth_headers,
        ).json()["unread_count"]
        == 1
    )

    unauthorized_dispatch = api.client.post("/api/v1/internal/notifications/dispatch")
    assert unauthorized_dispatch.status_code == 401
    dispatched = api.client.post(
        "/api/v1/internal/notifications/dispatch",
        headers={"Authorization": f"Bearer {DEVELOPMENT_CRON_SECRET}"},
    )
    assert dispatched.status_code == 200, dispatched.text
    assert dispatched.json()["processed"] >= 2
    assert dispatched.json()["remaining"] == 0


def test_search_following_feed_history_and_subscriptions(api):
    reader_headers, author_id = register_and_login(
        api,
        "discovery_reader",
        "搜索订阅读者",
    )

    subscribed = api.client.put(
        "/api/v1/subscriptions/board/daily",
        headers=reader_headers,
    )
    assert subscribed.status_code == 200, subscribed.text
    assert subscribed.json()["label"] == "校园日常"
    duplicate = api.client.put(
        "/api/v1/subscriptions/board/daily",
        headers=reader_headers,
    )
    assert duplicate.status_code == 200
    assert api.client.get("/api/v1/subscriptions", headers=reader_headers).json()["total"] == 1

    public_post = create_post(api, title="Python 编程交流活动")
    anonymous_post = create_post(api, anonymous=True, title="匿名编程交流")

    subscription_notifications = api.client.get(
        "/api/v1/notifications",
        headers=reader_headers,
        params={"unread_only": "true"},
    )
    assert subscription_notifications.status_code == 200
    assert {item["entity_id"] for item in subscription_notifications.json()["items"]} == {
        str(public_post["id"]),
        str(anonymous_post["id"]),
    }

    search = api.client.get(
        "/api/v1/search",
        headers=reader_headers,
        params={"q": "编程"},
    )
    assert search.status_code == 200, search.text
    search_payload = search.json()
    assert {item["id"] for item in search_payload["posts"]} == {
        public_post["id"],
        anonymous_post["id"],
    }
    assert search_payload["tags"][0]["name"] == "编程"

    author_name_search = api.client.get(
        "/api/v1/search",
        headers=reader_headers,
        params={"q": "接口测试同学", "types": "posts"},
    )
    assert author_name_search.status_code == 200
    assert [item["id"] for item in author_name_search.json()["posts"]] == [public_post["id"]]

    history = api.client.get(
        "/api/v1/search/history",
        headers=reader_headers,
    )
    assert history.status_code == 200
    assert [item["query"] for item in history.json()["items"]][:2] == [
        "接口测试同学",
        "编程",
    ]

    followed = api.client.put(
        f"/api/v1/users/{public_post['author_user_id']}/follow",
        headers=reader_headers,
    )
    assert followed.status_code == 200
    following_feed = api.client.get(
        "/api/v1/posts",
        headers=reader_headers,
        params={"feed": "following"},
    )
    assert following_feed.status_code == 200, following_feed.text
    assert [item["id"] for item in following_feed.json()["items"]] == [public_post["id"]]
    assert following_feed.json()["items"][0]["author_following"] is True

    recommended = api.client.get(
        "/api/v1/posts",
        headers=reader_headers,
        params={"sort": "recommended"},
    )
    assert recommended.status_code == 200, recommended.text
    assert {item["id"] for item in recommended.json()["items"]} == {
        public_post["id"],
        anonymous_post["id"],
    }

    unsubscribed = api.client.delete(
        "/api/v1/subscriptions/board/daily",
        headers=reader_headers,
    )
    assert unsubscribed.status_code == 204
    assert (
        api.client.get(
            "/api/v1/subscriptions",
            headers=reader_headers,
        ).json()["items"]
        == []
    )
    assert author_id != public_post["author_user_id"]
