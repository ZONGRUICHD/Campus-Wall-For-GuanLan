from datetime import UTC, datetime, timedelta

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


def create_lost_found_post(api) -> dict[str, object]:
    response = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": "寻找装有课程笔记的帆布袋",
            "body": "袋子里有高数笔记和一支蓝色钢笔，请核对细节后联系。",
            "board": "lost_found",
            "kind": "lost",
            "item_category": "books",
            "location": "第三教学楼 201",
            "occurred_at": (
                datetime.now(UTC) - timedelta(hours=2)
            ).isoformat(),
            "tags": ["失物", "帆布袋"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def submit_claim(
    api,
    post_id: object,
    headers: dict[str, str],
    *,
    message: str,
    anonymous: bool = True,
):
    return api.client.post(
        f"/api/v1/lost-found/{post_id}/claims",
        headers=headers,
        json={"message": message, "anonymous": anonymous},
    )


def test_private_claim_review_accepts_one_and_resolves_item(api):
    post = create_lost_found_post(api)
    first_headers, _ = register_and_login(api, "claimant_one")
    second_headers, _ = register_and_login(api, "claimant_two")

    own_claim = submit_claim(
        api,
        post["id"],
        api.auth_headers,
        message="这是我自己发布的物品，不应允许自己提交认领。",
    )
    assert own_claim.status_code == 422
    assert own_claim.json()["detail"]["code"] == "author_cannot_claim"

    first = submit_claim(
        api,
        post["id"],
        first_headers,
        message="袋子内页写有课程编号，我可以提供更具体的笔记页内容。",
    )
    second = submit_claim(
        api,
        post["id"],
        second_headers,
        message="我在同一教室见过相似帆布袋，可以补充外观和放置位置。",
        anonymous=False,
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["status"] == "pending"
    assert first.json()["is_mine"] is True
    assert first.json()["can_review"] is False

    duplicate = submit_claim(
        api,
        post["id"],
        first_headers,
        message="同一个进行中的认领不能重复提交。",
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "claim_already_exists"

    forbidden_list = api.client.get(
        f"/api/v1/lost-found/{post['id']}/claims",
        headers=first_headers,
    )
    assert forbidden_list.status_code == 403

    mine = api.client.get(
        "/api/v1/lost-found/claims/me",
        headers=first_headers,
        params={"post_id": post["id"]},
    )
    assert mine.status_code == 200, mine.text
    assert mine.json()["total"] == 1
    assert mine.json()["items"][0]["claimant_name"] == "claimant_one同学"

    owner_view = api.client.get(
        f"/api/v1/lost-found/{post['id']}/claims",
        headers=api.auth_headers,
    )
    assert owner_view.status_code == 200, owner_view.text
    claims_by_id = {item["id"]: item for item in owner_view.json()["items"]}
    assert claims_by_id[first.json()["id"]]["claimant_name"] == "匿名线索"
    assert claims_by_id[first.json()["id"]]["can_review"] is True
    assert claims_by_id[second.json()["id"]]["claimant_name"] == "claimant_two同学"

    accepted = api.client.patch(
        f"/api/v1/lost-found/{post['id']}/claims/{first.json()['id']}",
        headers=api.auth_headers,
        json={"status": "accepted"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    assert accepted.json()["can_review"] is False

    reviewed = api.client.get(
        f"/api/v1/lost-found/{post['id']}/claims",
        headers=api.auth_headers,
    ).json()["items"]
    reviewed_by_id = {item["id"]: item for item in reviewed}
    assert reviewed_by_id[first.json()["id"]]["status"] == "accepted"
    assert reviewed_by_id[second.json()["id"]]["status"] == "rejected"

    feed = api.client.get(
        "/api/v1/posts",
        headers=first_headers,
        params={"query": "课程笔记"},
    )
    assert feed.status_code == 200
    assert feed.json()["items"][0]["resolved"] is True

    closed = submit_claim(
        api,
        post["id"],
        second_headers,
        message="物品解决后不能再次提交认领线索。",
        anonymous=False,
    )
    assert closed.status_code == 409
    assert closed.json()["detail"]["code"] == "item_already_resolved"


def test_rejected_claim_can_be_resubmitted_and_pending_claim_cancelled(api):
    post = create_lost_found_post(api)
    claimant_headers, _ = register_and_login(api, "claimant_retry")
    other_headers, _ = register_and_login(api, "claimant_other")

    short = submit_claim(
        api,
        post["id"],
        claimant_headers,
        message="太短",
    )
    assert short.status_code == 422

    created = submit_claim(
        api,
        post["id"],
        claimant_headers,
        message="我能说明袋子侧边的图案以及笔记中夹着的课程表。",
    )
    assert created.status_code == 201, created.text

    rejected = api.client.patch(
        f"/api/v1/lost-found/{post['id']}/claims/{created.json()['id']}",
        headers=api.auth_headers,
        json={"status": "rejected"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"

    resubmitted = submit_claim(
        api,
        post["id"],
        claimant_headers,
        message="补充：袋子拉链上系着绿色绳结，课程表是周三下午。",
        anonymous=False,
    )
    assert resubmitted.status_code == 201, resubmitted.text
    assert resubmitted.json()["id"] == created.json()["id"]
    assert resubmitted.json()["status"] == "pending"
    assert resubmitted.json()["anonymous"] is False

    forbidden_cancel = api.client.delete(
        f"/api/v1/lost-found/{post['id']}/claims/{created.json()['id']}",
        headers=other_headers,
    )
    assert forbidden_cancel.status_code == 403

    cancelled = api.client.delete(
        f"/api/v1/lost-found/{post['id']}/claims/{created.json()['id']}",
        headers=claimant_headers,
    )
    assert cancelled.status_code == 204

    mine = api.client.get(
        "/api/v1/lost-found/claims/me",
        headers=claimant_headers,
        params={"post_id": post["id"]},
    ).json()["items"]
    assert mine[0]["status"] == "cancelled"
    assert mine[0]["can_review"] is False


def test_moderator_cannot_review_their_own_claim(api):
    post = create_lost_found_post(api)
    moderator_headers, moderator_id = register_and_login(api, "claim_moderator")
    with api.session_factory() as session, session.begin():
        session.add(UserRole(user_id=moderator_id, role_name="moderator"))

    claim = submit_claim(
        api,
        post["id"],
        moderator_headers,
        message="审核员也可能是物品主人，但不能审核自己的认领线索。",
        anonymous=False,
    )
    assert claim.status_code == 201, claim.text

    listed = api.client.get(
        f"/api/v1/lost-found/{post['id']}/claims",
        headers=moderator_headers,
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["items"][0]["can_review"] is False

    self_review = api.client.patch(
        f"/api/v1/lost-found/{post['id']}/claims/{claim.json()['id']}",
        headers=moderator_headers,
        json={"status": "accepted"},
    )
    assert self_review.status_code == 403
    assert self_review.json()["detail"]["code"] == "self_review_forbidden"
