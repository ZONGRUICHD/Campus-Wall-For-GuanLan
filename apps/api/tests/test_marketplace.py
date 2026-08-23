from campus_wall_api.models import UserRole


def register_and_login(api, username: str) -> tuple[dict[str, str], str]:
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
    return (
        {"Authorization": f"Bearer {login.json()['access_token']}"},
        registered.json()["id"],
    )


def marketplace_details(**overrides) -> dict[str, object]:
    return {
        "category": "books",
        "condition": "good",
        "price_cents": 2800,
        "original_price_cents": 5980,
        "negotiable": True,
        "trade_method": "campus_meetup",
        "meetup_location": "图书馆一楼大厅",
        **overrides,
    }


def create_listing(api, headers=None, **overrides) -> dict[str, object]:
    payload = {
        "title": "出一本高等数学教材",
        "body": "书页干净，只有少量铅笔笔记，可以校内当面检查。",
        "board": "marketplace",
        "tags": ["教材", "二手"],
        "marketplace": marketplace_details(),
        **overrides,
    }
    response = api.client.post(
        "/api/v1/posts",
        headers=headers or api.auth_headers,
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_listing_validation_filtering_and_editing(api):
    missing_details = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": "缺少商品信息",
            "body": "这条内容不应成功发布。",
            "board": "marketplace",
        },
    )
    assert missing_details.status_code == 422

    anonymous = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": "匿名商品",
            "body": "二手交易卖家不能匿名。",
            "board": "marketplace",
            "anonymous": True,
            "marketplace": marketplace_details(),
        },
    )
    assert anonymous.status_code == 422

    wrong_board = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": "普通帖子",
            "body": "普通板块不能携带商品字段。",
            "board": "daily",
            "marketplace": marketplace_details(),
        },
    )
    assert wrong_board.status_code == 422

    prohibited = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": "转让校园卡",
            "body": "违规物品不应进入交易板块。",
            "board": "marketplace",
            "marketplace": marketplace_details(),
        },
    )
    assert prohibited.status_code == 422
    assert prohibited.json()["detail"]["code"] == "marketplace_prohibited_item"

    book = create_listing(api)
    electronics = create_listing(
        api,
        title="出闲置机械键盘",
        body="功能正常，可在校内现场试用后交易。",
        marketplace=marketplace_details(
            category="electronics",
            condition="like_new",
            price_cents=12_000,
            original_price_cents=23_900,
            negotiable=False,
            meetup_location="二食堂门口",
        ),
    )

    assert book["marketplace"] == {
        "category": "books",
        "condition": "good",
        "price_cents": 2800,
        "original_price_cents": 5980,
        "negotiable": True,
        "trade_method": "campus_meetup",
        "meetup_location": "图书馆一楼大厅",
        "status": "available",
        "seller_user_id": book["marketplace"]["seller_user_id"],
    }
    assert book["marketplace"]["seller_user_id"]
    assert book["can_edit"] is True

    books = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"board": "marketplace", "marketplace_category": "books"},
    )
    affordable = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"board": "marketplace", "price_max_cents": 5000},
    )
    electronics_only = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={
            "marketplace_category": "electronics",
            "price_min_cents": 10_000,
            "price_max_cents": 15_000,
        },
    )
    assert [item["id"] for item in books.json()["items"]] == [book["id"]]
    assert [item["id"] for item in affordable.json()["items"]] == [book["id"]]
    assert [item["id"] for item in electronics_only.json()["items"]] == [electronics["id"]]

    invalid_range = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"price_min_cents": 5000, "price_max_cents": 1000},
    )
    assert invalid_range.status_code == 422
    assert invalid_range.json()["detail"]["code"] == "invalid_price_range"

    updated = api.client.patch(
        f"/api/v1/posts/{book['id']}",
        headers=api.auth_headers,
        json={
            "title": "出高等数学教材（已降价）",
            "marketplace": {
                "condition": "like_new",
                "price_cents": 2600,
                "original_price_cents": None,
                "meetup_location": "图书馆北门",
            },
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["marketplace"]["condition"] == "like_new"
    assert updated.json()["marketplace"]["price_cents"] == 2600
    assert updated.json()["marketplace"]["original_price_cents"] is None
    assert updated.json()["marketplace"]["meetup_location"] == "图书馆北门"

    invalid_reference = api.client.patch(
        f"/api/v1/posts/{book['id']}",
        headers=api.auth_headers,
        json={
            "marketplace": {
                "price_cents": 3000,
                "original_price_cents": 2000,
            }
        },
    )
    assert invalid_reference.status_code == 422
    assert invalid_reference.json()["detail"]["code"] == "invalid_marketplace_price_reference"

    prohibited_edit = api.client.patch(
        f"/api/v1/posts/{book['id']}",
        headers=api.auth_headers,
        json={"body": "改成出售游戏账号"},
    )
    assert prohibited_edit.status_code == 422
    assert prohibited_edit.json()["detail"]["code"] == "marketplace_prohibited_item"

    persisted = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "已降价"},
    ).json()["items"][0]
    assert persisted["body"] == book["body"]
    assert persisted["marketplace"]["price_cents"] == 2600


def test_private_inquiry_reply_and_listing_status_lifecycle(api):
    listing = create_listing(api)
    first_headers, _ = register_and_login(api, "market_buyer_one")
    second_headers, _ = register_and_login(api, "market_buyer_two")
    third_headers, _ = register_and_login(api, "market_buyer_three")

    own_inquiry = api.client.post(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=api.auth_headers,
        json={"message": "卖家不能询问自己的商品。", "anonymous": True},
    )
    assert own_inquiry.status_code == 422
    assert own_inquiry.json()["detail"]["code"] == "seller_inquiry_forbidden"

    first = api.client.post(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=first_headers,
        json={"message": "想确认书里具体有哪些笔记，可以明天下午看书吗？", "anonymous": True},
    )
    second = api.client.post(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=second_headers,
        json={"message": "请问今天晚饭后方便在图书馆交易吗？", "anonymous": False},
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["buyer_name"] == "market_buyer_one同学"
    assert first.json()["is_mine"] is True

    duplicate = api.client.post(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=first_headers,
        json={"message": "进行中的询价不能重复提交。", "anonymous": True},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "marketplace_inquiry_exists"

    forbidden = api.client.get(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=third_headers,
    )
    assert forbidden.status_code == 403

    seller_view = api.client.get(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=api.auth_headers,
    )
    assert seller_view.status_code == 200, seller_view.text
    by_id = {item["id"]: item for item in seller_view.json()["items"]}
    assert by_id[first.json()["id"]]["buyer_name"] == "匿名买家"
    assert by_id[first.json()["id"]]["can_reply"] is True
    assert by_id[second.json()["id"]]["buyer_name"] == "market_buyer_two同学"

    replied = api.client.patch(
        f"/api/v1/marketplace/{listing['id']}/inquiries/{first.json()['id']}",
        headers=api.auth_headers,
        json={
            "seller_reply": "可以，明天下午四点在图书馆北门见，现场核对书况。",
            "status": "replied",
        },
    )
    assert replied.status_code == 200, replied.text
    assert replied.json()["status"] == "replied"
    assert replied.json()["can_reply"] is True

    mine = api.client.get(
        "/api/v1/marketplace/inquiries/me",
        headers=first_headers,
        params={"post_id": listing["id"]},
    )
    assert mine.status_code == 200, mine.text
    assert mine.json()["items"][0]["seller_reply"] == replied.json()["seller_reply"]

    cancelled = api.client.delete(
        f"/api/v1/marketplace/{listing['id']}/inquiries/{first.json()['id']}",
        headers=first_headers,
    )
    assert cancelled.status_code == 204

    resubmitted = api.client.post(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=first_headers,
        json={"message": "时间有变化，想改到后天下午再当面看书。", "anonymous": False},
    )
    assert resubmitted.status_code == 201, resubmitted.text
    assert resubmitted.json()["id"] == first.json()["id"]
    assert resubmitted.json()["status"] == "pending"
    assert resubmitted.json()["seller_reply"] is None

    reserved = api.client.patch(
        f"/api/v1/marketplace/{listing['id']}/status",
        headers=api.auth_headers,
        json={"status": "reserved"},
    )
    assert reserved.status_code == 200, reserved.text
    assert reserved.json()["status"] == "reserved"

    third = api.client.post(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=third_headers,
        json={"message": "如果预留取消，希望可以通知我来现场看书。", "anonymous": True},
    )
    assert third.status_code == 201, third.text

    sold = api.client.patch(
        f"/api/v1/marketplace/{listing['id']}/status",
        headers=api.auth_headers,
        json={"status": "sold"},
    )
    assert sold.status_code == 200, sold.text
    assert sold.json()["status"] == "sold"

    closed_inquiries = api.client.get(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=api.auth_headers,
    ).json()["items"]
    assert {item["status"] for item in closed_inquiries} == {"closed"}
    assert not any(item["can_reply"] for item in closed_inquiries)

    unavailable = api.client.post(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=third_headers,
        json={"message": "已售出的商品不应再接受新的询价。", "anonymous": True},
    )
    assert unavailable.status_code == 409
    assert unavailable.json()["detail"]["code"] == "marketplace_listing_unavailable"

    sold_feed = api.client.get(
        "/api/v1/posts",
        headers=first_headers,
        params={"marketplace_status": "sold"},
    )
    assert [item["id"] for item in sold_feed.json()["items"]] == [listing["id"]]

    withdrawn = api.client.patch(
        f"/api/v1/marketplace/{listing['id']}/status",
        headers=api.auth_headers,
        json={"status": "withdrawn"},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "withdrawn"
    assert (
        api.client.get(
            "/api/v1/posts",
            headers=first_headers,
            params={"query": "高等数学教材"},
        ).json()["items"]
        == []
    )
    assert (
        api.client.post(
            f"/api/v1/posts/{listing['id']}/bookmark",
            headers=first_headers,
        ).status_code
        == 404
    )
    assert (
        api.client.post(
            f"/api/v1/posts/{listing['id']}/reactions",
            headers=first_headers,
        ).status_code
        == 404
    )
    assert (
        api.client.post(
            f"/api/v1/posts/{listing['id']}/comments",
            headers=first_headers,
            json={"body": "下架商品不应继续接收公开评论。"},
        ).status_code
        == 404
    )
    mine_after_withdrawal = api.client.get(
        "/api/v1/posts/me",
        headers=api.auth_headers,
    ).json()["items"]
    assert mine_after_withdrawal[0]["marketplace"]["status"] == "withdrawn"


def test_moderator_can_inspect_and_withdraw_but_cannot_reply_or_mark_sold(api):
    listing = create_listing(api)
    buyer_headers, _ = register_and_login(api, "market_private_buyer")
    moderator_headers, moderator_id = register_and_login(api, "market_moderator")
    with api.session_factory() as session, session.begin():
        session.add(UserRole(user_id=moderator_id, role_name="moderator"))

    inquiry = api.client.post(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=buyer_headers,
        json={"message": "这是一条需要审核员可追溯身份的匿名询价。", "anonymous": True},
    )
    assert inquiry.status_code == 201, inquiry.text

    moderator_view = api.client.get(
        f"/api/v1/marketplace/{listing['id']}/inquiries",
        headers=moderator_headers,
    )
    assert moderator_view.status_code == 200, moderator_view.text
    assert moderator_view.json()["items"][0]["buyer_name"] == "market_private_buyer同学"
    assert moderator_view.json()["items"][0]["can_reply"] is False

    reply = api.client.patch(
        f"/api/v1/marketplace/{listing['id']}/inquiries/{inquiry.json()['id']}",
        headers=moderator_headers,
        json={"seller_reply": "审核员不能冒充卖家回复。", "status": "closed"},
    )
    assert reply.status_code == 403
    assert reply.json()["detail"]["code"] == "seller_reply_forbidden"

    sold = api.client.patch(
        f"/api/v1/marketplace/{listing['id']}/status",
        headers=moderator_headers,
        json={"status": "sold"},
    )
    assert sold.status_code == 403
    assert sold.json()["detail"]["code"] == "moderator_status_restricted"

    withdrawn = api.client.patch(
        f"/api/v1/marketplace/{listing['id']}/status",
        headers=moderator_headers,
        json={"status": "withdrawn"},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "withdrawn"
