from datetime import UTC, datetime, timedelta

import pytest

from campus_wall_api.schemas import Board
from campus_wall_api.seed import seed_database


def create_post(api, board: str = "daily", **overrides):
    payload = {
        "title": "测试帖子",
        "body": "这是一条用于 API 测试的校园墙内容。",
        "board": board,
        "author_name": "测试同学",
        "anonymous": False,
        "tags": ["测试"],
    }
    if board == "lost_found":
        payload.update(
            {
                "kind": "lost",
                "item_category": "other",
                "location": "教学楼",
                "occurred_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
            }
        )
    if board == "marketplace":
        payload["marketplace"] = {
            "category": "books",
            "condition": "good",
            "price_cents": 2500,
            "original_price_cents": 5900,
            "negotiable": True,
            "trade_method": "campus_meetup",
            "meetup_location": "图书馆一楼",
        }
    payload.update(overrides)
    response = api.client.post(
        "/api/v1/posts",
        json=payload,
        headers=api.auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_health_and_empty_database(api):
    assert api.client.get("/health").json() == {"status": "ok"}

    response = api.client.get("/api/v1/posts", headers=api.auth_headers)

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}


def test_campus_content_requires_an_authenticated_session(api):
    assert api.client.get("/api/v1/posts").status_code == 401
    assert (
        api.client.post(
            "/api/v1/posts",
            json={"title": "未登录", "body": "不能发布", "board": "daily"},
        ).status_code
        == 401
    )


def test_browser_frontend_cors_preflight(api):
    response = api.client.options(
        "/api/v1/posts",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_seed_is_idempotent(api):
    first = seed_database(api.session_factory)
    second = seed_database(api.session_factory)

    assert first.model_dump() == {"inserted": 6, "existing": 0, "total": 6}
    assert second.model_dump() == {"inserted": 0, "existing": 6, "total": 6}

    response = api.client.get(
        "/api/v1/posts",
        params={"limit": 100},
        headers=api.auth_headers,
    )
    items = response.json()["items"]
    assert len(items) == 6
    assert {item["board"] for item in items} == {board.value for board in Board}


@pytest.mark.parametrize(
    ("board", "extra"),
    [
        ("news", {}),
        ("daily", {}),
        (
            "lost_found",
            {
                "kind": "found",
                "item_category": "electronics",
                "location": "体育馆",
                "resolved": False,
            },
        ),
        ("marketplace", {}),
        ("confession", {"anonymous": True}),
        ("tree_hole", {"anonymous": True}),
    ],
)
def test_create_all_six_boards(api, board, extra):
    post = create_post(api, board, **extra)

    assert post["board"] == board
    assert post["reaction_count"] == 0
    assert post["comment_count"] == 0
    assert post["liked"] is False
    assert post["kind"] == (extra.get("kind") if board == "lost_found" else None)
    assert post["item_category"] == (extra.get("item_category") if board == "lost_found" else None)
    assert (post["marketplace"] is not None) is (board == "marketplace")
    assert "created_at" in post
    assert "authorName" not in post
    if extra.get("anonymous"):
        assert post["author_name"] == "匿名同学"
    else:
        assert post["author_name"] == "接口测试同学"


def test_tree_hole_can_omit_title(api):
    response = api.client.post(
        "/api/v1/posts",
        json={"body": "这是一条没有标题的树洞。", "board": "tree_hole", "anonymous": True},
        headers=api.auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["title"] is None


def test_news_requires_title(api):
    response = api.client.post(
        "/api/v1/posts",
        json={"body": "资讯正文", "board": "news", "author_name": "校园墙"},
        headers=api.auth_headers,
    )

    assert response.status_code == 422


def test_search_board_resolution_filters_and_cursor(api):
    daily = create_post(
        api,
        "daily",
        title="蓝色雨伞与晚霞",
        body="今天放学时看到了晚霞。",
        tags=["摄影"],
    )
    unresolved = create_post(
        api,
        "lost_found",
        title="寻找蓝色雨伞",
        body="雨伞落在实验楼。",
        kind="lost",
        item_category="documents",
        location="实验楼 201",
        occurred_at=(datetime.now(UTC) - timedelta(days=2)).isoformat(),
    )
    resolved = create_post(
        api,
        "lost_found",
        title="捡到黑色水杯",
        body="已经交还失主。",
        kind="found",
        item_category="electronics",
        location="食堂",
        occurred_at=(datetime.now(UTC) - timedelta(days=20)).isoformat(),
        resolved=True,
    )

    search = api.client.get(
        "/api/v1/posts",
        params={"query": "蓝色雨伞"},
        headers=api.auth_headers,
    ).json()
    assert {item["id"] for item in search["items"]} == {daily["id"], unresolved["id"]}

    board = api.client.get(
        "/api/v1/posts",
        params={"board": "daily"},
        headers=api.auth_headers,
    ).json()
    assert [item["id"] for item in board["items"]] == [daily["id"]]

    open_items = api.client.get(
        "/api/v1/posts",
        params={"lost_found_state": "unresolved"},
        headers=api.auth_headers,
    ).json()
    assert [item["id"] for item in open_items["items"]] == [unresolved["id"]]

    resolved_items = api.client.get(
        "/api/v1/posts",
        params={"lost_found_state": "resolved"},
        headers=api.auth_headers,
    ).json()
    assert [item["id"] for item in resolved_items["items"]] == [resolved["id"]]

    all_lost_found = api.client.get(
        "/api/v1/posts",
        params={"lost_found_state": "all"},
        headers=api.auth_headers,
    ).json()
    assert {item["id"] for item in all_lost_found["items"]} == {
        unresolved["id"],
        resolved["id"],
    }

    documents = api.client.get(
        "/api/v1/posts",
        params={"lost_found_category": "documents"},
        headers=api.auth_headers,
    ).json()
    assert [item["id"] for item in documents["items"]] == [unresolved["id"]]

    recent = api.client.get(
        "/api/v1/posts",
        params={
            "occurred_after": (datetime.now(UTC) - timedelta(days=7)).isoformat(),
        },
        headers=api.auth_headers,
    ).json()
    assert [item["id"] for item in recent["items"]] == [unresolved["id"]]

    first_page = api.client.get(
        "/api/v1/posts",
        params={"sort": "oldest", "limit": 2},
        headers=api.auth_headers,
    ).json()
    assert len(first_page["items"]) == 2
    assert first_page["next_cursor"] is not None

    second_page = api.client.get(
        "/api/v1/posts",
        params={
            "sort": "oldest",
            "limit": 2,
            "cursor": first_page["next_cursor"],
        },
        headers=api.auth_headers,
    ).json()
    assert [item["id"] for item in second_page["items"]] == [resolved["id"]]
    assert second_page["next_cursor"] is None


def test_reaction_toggles_demo_actor(api):
    post = create_post(api)

    liked = api.client.post(
        f"/api/v1/posts/{post['id']}/reactions",
        headers=api.auth_headers,
    )
    unliked = api.client.post(
        f"/api/v1/posts/{post['id']}/reactions",
        headers=api.auth_headers,
    )

    assert liked.status_code == 200
    assert liked.json() == {"post_id": post["id"], "reaction_count": 1, "liked": True}
    assert unliked.status_code == 200
    assert unliked.json() == {"post_id": post["id"], "reaction_count": 0, "liked": False}


def test_comment_is_created_and_counted(api):
    post = create_post(api)

    response = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        json={"body": "我也看到了！", "author_name": "路过同学", "anonymous": True},
        headers=api.auth_headers,
    )

    assert response.status_code == 201
    comment = response.json()
    assert comment["post_id"] == post["id"]
    assert comment["body"] == "我也看到了！"
    assert comment["author_name"] == "匿名同学"

    listed = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
    ).json()["items"]
    assert listed[0]["comment_count"] == 1
    assert listed[0]["comments"] == [comment]


def test_only_lost_found_posts_can_be_resolved(api):
    daily = create_post(api, "daily")
    lost_found = create_post(api, "lost_found")

    rejected = api.client.patch(
        f"/api/v1/posts/{daily['id']}/resolution",
        json={"resolved": True},
        headers=api.auth_headers,
    )
    updated = api.client.patch(
        f"/api/v1/posts/{lost_found['id']}/resolution",
        json={"resolved": True},
        headers=api.auth_headers,
    )

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "board_does_not_support_resolution"
    assert updated.status_code == 200
    assert updated.json()["post_id"] == lost_found["id"]
    assert updated.json()["resolved"] is True


def test_lost_found_kind_is_required_and_other_boards_reject_its_fields(api):
    missing_kind = api.client.post(
        "/api/v1/posts",
        json={"title": "失物", "body": "找东西", "board": "lost_found"},
        headers=api.auth_headers,
    )
    wrong_board = api.client.post(
        "/api/v1/posts",
        json={
            "title": "日常",
            "body": "普通内容",
            "board": "daily",
            "kind": "lost",
        },
        headers=api.auth_headers,
    )

    assert missing_kind.status_code == 422
    assert wrong_board.status_code == 422


def test_lost_found_details_can_be_updated_but_not_cleared(api):
    post = create_post(api, "lost_found")
    occurred_at = datetime.now(UTC) - timedelta(days=1)

    updated = api.client.patch(
        f"/api/v1/posts/{post['id']}",
        headers=api.auth_headers,
        json={
            "kind": "found",
            "item_category": "keys",
            "location": "图书馆服务台",
            "occurred_at": occurred_at.isoformat(),
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["kind"] == "found"
    assert updated.json()["item_category"] == "keys"
    assert updated.json()["location"] == "图书馆服务台"
    assert datetime.fromisoformat(updated.json()["occurred_at"]) == occurred_at

    cleared = api.client.patch(
        f"/api/v1/posts/{post['id']}",
        headers=api.auth_headers,
        json={"item_category": None},
    )
    assert cleared.status_code == 422
    assert cleared.json()["detail"]["code"] == "lost_found_details_required"

    daily = create_post(api)
    wrong_board = api.client.patch(
        f"/api/v1/posts/{daily['id']}",
        headers=api.auth_headers,
        json={"item_category": "other"},
    )
    assert wrong_board.status_code == 422
    assert wrong_board.json()["detail"]["code"] == "board_does_not_support_lost_found_details"
