from campus_wall_api.access_control import bootstrap_super_admin


def authorization(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def login(api, username: str, password: str):
    response = api.client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()


def register(api, username: str):
    response = api.client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "password": "Student2026",
            "display_name": username,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def ready_admin(api):
    bootstrap_super_admin(
        api.session_factory,
        username="admin",
        password="zongrui2",
    )
    first = login(api, "admin", "zongrui2")
    changed = api.client.post(
        "/api/v1/auth/change-password",
        headers=authorization(first["access_token"]),
        json={
            "current_password": "zongrui2",
            "new_password": "Zongrui2026",
        },
    )
    assert changed.status_code == 204, changed.text
    return authorization(login(api, "admin", "Zongrui2026")["access_token"])


def create_post(api, title: str):
    response = api.client.post(
        "/api/v1/posts",
        headers=api.auth_headers,
        json={
            "title": title,
            "body": "治理闭环测试内容",
            "board": "daily",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_emergency_report_hide_appeal_restore_and_audit(api):
    post = create_post(api, "举报申诉闭环")
    register(api, "reporter01")
    reporter_headers = authorization(login(api, "reporter01", "Student2026")["access_token"])

    reported = api.client.post(
        "/api/v1/reports",
        headers=reporter_headers,
        json={
            "target_type": "post",
            "target_id": str(post["id"]),
            "category": "privacy",
            "description": "内容疑似包含不应公开的个人信息。",
            "emergency": True,
        },
    )
    duplicate = api.client.post(
        "/api/v1/reports",
        headers=reporter_headers,
        json={
            "target_type": "post",
            "target_id": str(post["id"]),
            "category": "privacy",
            "description": "重复提交同一目标的举报。",
        },
    )
    assert reported.status_code == 201, reported.text
    assert reported.json()["priority"] == 100
    assert duplicate.status_code == 409
    assert (
        api.client.get(
            "/api/v1/admin/reports",
            headers=reporter_headers,
        ).status_code
        == 403
    )

    admin_headers = ready_admin(api)
    queue = api.client.get("/api/v1/admin/reports", headers=admin_headers)
    assert queue.status_code == 200
    assert queue.json()["items"][0]["id"] == reported.json()["id"]

    resolved = api.client.patch(
        f"/api/v1/admin/reports/{reported.json()['id']}",
        headers=admin_headers,
        json={
            "status": "resolved",
            "resolution": "确认存在隐私风险，内容已下架。",
            "hide_target": True,
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"
    hidden_feed = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "举报申诉闭环"},
    )
    assert hidden_feed.json()["items"] == []

    appeal = api.client.post(
        "/api/v1/appeals",
        headers=api.auth_headers,
        json={
            "target_type": "post",
            "target_id": str(post["id"]),
            "reason": "内容已经去除个人信息，请申请复核恢复。",
        },
    )
    assert appeal.status_code == 201, appeal.text

    approved = api.client.patch(
        f"/api/v1/admin/appeals/{appeal.json()['id']}",
        headers=admin_headers,
        json={
            "status": "approved",
            "resolution": "复核通过，恢复展示。",
        },
    )
    assert approved.status_code == 200
    restored_feed = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "举报申诉闭环"},
    )
    assert [item["id"] for item in restored_feed.json()["items"]] == [post["id"]]

    my_reports = api.client.get("/api/v1/reports/me", headers=reporter_headers)
    assert my_reports.json()["items"][0]["resolution"] == "确认存在隐私风险，内容已下架。"
    audit = api.client.get("/api/v1/admin/audit-logs", headers=admin_headers)
    assert audit.status_code == 200
    actions = {item["action"] for item in audit.json()["items"]}
    assert {
        "report.submitted",
        "report.resolved",
        "moderation.content_hidden",
        "appeal.submitted",
        "appeal.approved",
        "moderation.content_published",
    }.issubset(actions)


def test_comment_moderation_removes_comment_from_public_feed(api):
    post = create_post(api, "评论审核")
    comment = api.client.post(
        f"/api/v1/posts/{post['id']}/comments",
        headers=api.auth_headers,
        json={"body": "等待审核的评论"},
    )
    assert comment.status_code == 201
    admin_headers = ready_admin(api)

    hidden = api.client.patch(
        f"/api/v1/admin/moderation/comment/{comment.json()['id']}",
        headers=admin_headers,
        json={"status": "hidden", "reason": "违反社区规范"},
    )
    feed = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "评论审核"},
    )

    assert hidden.status_code == 200
    assert hidden.json()["status"] == "hidden"
    assert feed.json()["items"][0]["comment_count"] == 0
    assert feed.json()["items"][0]["comments"] == []


def test_user_suspension_revokes_sessions_and_super_admin_is_protected(api):
    target = register(api, "suspend_target")
    target_token = login(api, "suspend_target", "Student2026")["access_token"]
    target_headers = authorization(target_token)
    admin_headers = ready_admin(api)
    admin = api.client.get("/api/v1/auth/me", headers=admin_headers).json()

    suspended = api.client.patch(
        f"/api/v1/admin/users/{target['id']}/status",
        headers=admin_headers,
        json={
            "status": "suspended",
            "reason": "自动化测试：临时限制账号能力。",
        },
    )

    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"
    assert api.client.get("/api/v1/auth/me", headers=target_headers).status_code == 401
    assert (
        api.client.post(
            "/api/v1/auth/login",
            json={"username": "suspend_target", "password": "Student2026"},
        ).status_code
        == 403
    )
    protected = api.client.patch(
        f"/api/v1/admin/users/{admin['id']}/status",
        headers=admin_headers,
        json={"status": "suspended", "reason": "不应允许限制最高管理员。"},
    )
    assert protected.status_code == 409

    restored = api.client.patch(
        f"/api/v1/admin/users/{target['id']}/status",
        headers=admin_headers,
        json={"status": "active", "reason": "复核通过，恢复账号。"},
    )
    assert restored.status_code == 200
    assert login(api, "suspend_target", "Student2026")["user"]["status"] == "active"


def test_report_evidence_ownership_and_active_content_appeal_are_enforced(api):
    post = create_post(api, "证据边界")
    wrong_evidence = api.client.post(
        "/api/v1/reports",
        headers=api.auth_headers,
        json={
            "target_type": "post",
            "target_id": str(post["id"]),
            "category": "other",
            "description": "证据对象不属于当前用户。",
            "evidence_object_keys": ["reports/someone-else/evidence.png"],
        },
    )
    premature_appeal = api.client.post(
        "/api/v1/appeals",
        headers=api.auth_headers,
        json={
            "target_type": "post",
            "target_id": str(post["id"]),
            "reason": "仍在正常展示的内容不能发起申诉。",
        },
    )
    assert wrong_evidence.status_code == 422
    assert premature_appeal.status_code == 404
