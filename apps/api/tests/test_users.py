from campus_wall_api.access_control import bootstrap_super_admin


def authorization(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register(api, username: str, display_name: str = "目标同学"):
    response = api.client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "password": "Student2026",
            "display_name": display_name,
            "email": f"{username}@example.edu",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def login(api, username: str, password: str = "Student2026"):
    response = api.client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()


def ready_admin_headers(api) -> dict[str, str]:
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


def test_profile_privacy_and_private_profile_visibility(api):
    target = register(api, "profile_target")
    target_headers = authorization(login(api, "profile_target")["access_token"])

    updated = api.client.patch(
        "/api/v1/users/me/profile",
        headers=api.auth_headers,
        json={
            "display_name": "新昵称",
            "bio": "这是我的校园简介。",
            "avatar_url": "https://cdn.example.edu/avatar.png",
        },
    )
    private = api.client.patch(
        "/api/v1/users/me/privacy",
        headers=api.auth_headers,
        json={
            "profile_visibility": "private",
            "show_activity": False,
            "allow_direct_messages": False,
        },
    )

    assert updated.status_code == 200
    assert updated.json()["bio"] == "这是我的校园简介。"
    assert private.status_code == 200
    assert private.json()["profile_visibility"] == "private"
    assert private.json()["show_activity"] is False

    me = api.client.get("/api/v1/auth/me", headers=api.auth_headers).json()
    hidden = api.client.get(
        f"/api/v1/users/{me['id']}/profile",
        headers=target_headers,
    )
    own = api.client.get("/api/v1/users/me/profile", headers=api.auth_headers)
    assert hidden.status_code == 404
    assert own.status_code == 200
    assert own.json()["display_name"] == "新昵称"
    assert target["id"] != me["id"]


def test_device_sessions_can_be_listed_and_revoked(api):
    second_login = login(api, "api_tester", "ApiTester2026")
    second_headers = authorization(second_login["access_token"])

    listed = api.client.get("/api/v1/users/me/sessions", headers=second_headers)

    assert listed.status_code == 200
    sessions = listed.json()["items"]
    assert len(sessions) == 2
    assert sum(item["current"] for item in sessions) == 1
    assert all("ip_hash" not in item for item in sessions)

    old_session = next(item for item in sessions if not item["current"])
    revoked = api.client.delete(
        f"/api/v1/users/me/sessions/{old_session['id']}",
        headers=second_headers,
    )
    assert revoked.status_code == 204
    assert api.client.get("/api/v1/auth/me", headers=api.auth_headers).status_code == 401
    assert api.client.get("/api/v1/auth/me", headers=second_headers).status_code == 200


def test_follow_block_and_unblock_are_mutually_safe(api):
    target = register(api, "relationship_target")

    followed = api.client.put(
        f"/api/v1/users/{target['id']}/follow",
        headers=api.auth_headers,
    )
    profile = api.client.get(
        f"/api/v1/users/{target['id']}/profile",
        headers=api.auth_headers,
    )
    blocked = api.client.put(
        f"/api/v1/users/{target['id']}/block",
        headers=api.auth_headers,
    )

    assert followed.status_code == 200
    assert followed.json()["following"] is True
    assert profile.json()["follower_count"] == 1
    assert blocked.status_code == 200
    assert blocked.json() == {
        "user_id": target["id"],
        "following": False,
        "blocked": True,
    }
    assert (
        api.client.get(
            f"/api/v1/users/{target['id']}/profile",
            headers=api.auth_headers,
        ).status_code
        == 404
    )
    assert (
        api.client.put(
            f"/api/v1/users/{target['id']}/follow",
            headers=api.auth_headers,
        ).status_code
        == 409
    )

    unblocked = api.client.delete(
        f"/api/v1/users/{target['id']}/block",
        headers=api.auth_headers,
    )
    followed_again = api.client.put(
        f"/api/v1/users/{target['id']}/follow",
        headers=api.auth_headers,
    )
    assert unblocked.status_code == 200
    assert unblocked.json()["blocked"] is False
    assert followed_again.status_code == 200
    assert followed_again.json()["following"] is True


def test_campus_verification_hashes_identifier_and_requires_admin_review(api):
    submitted = api.client.post(
        "/api/v1/users/me/campus-verification",
        headers=api.auth_headers,
        json={
            "school_name": "观澜学校",
            "student_identifier": "GL-2026-0001",
        },
    )
    duplicate_pending = api.client.post(
        "/api/v1/users/me/campus-verification",
        headers=api.auth_headers,
        json={
            "school_name": "观澜学校",
            "student_identifier": "GL-2026-0001",
        },
    )
    forbidden = api.client.get(
        "/api/v1/admin/campus-verifications",
        headers=api.auth_headers,
    )

    assert submitted.status_code == 201, submitted.text
    assert submitted.json()["status"] == "pending"
    assert "identifier" not in submitted.text
    assert duplicate_pending.status_code == 409
    assert forbidden.status_code == 403

    admin_headers = ready_admin_headers(api)
    listed = api.client.get(
        "/api/v1/admin/campus-verifications",
        headers=admin_headers,
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    approved = api.client.patch(
        f"/api/v1/admin/campus-verifications/{submitted.json()['id']}",
        headers=admin_headers,
        json={"status": "approved", "review_note": "校内身份已核验"},
    )
    profile = api.client.get("/api/v1/users/me/profile", headers=api.auth_headers)
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert profile.json()["campus_verified"] is True


def test_account_deletion_anonymizes_content_and_revokes_sessions(api):
    user = register(api, "delete_target", "待注销同学")
    session = login(api, "delete_target")
    headers = authorization(session["access_token"])
    created = api.client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "title": "注销前的帖子",
            "body": "账号注销后不应继续暴露身份。",
            "board": "daily",
        },
    )
    assert created.status_code == 201

    deleted = api.client.post(
        "/api/v1/users/me/delete",
        headers=headers,
        json={"password": "Student2026", "confirmation": "DELETE"},
    )

    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    assert api.client.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert (
        api.client.post(
            "/api/v1/auth/login",
            json={"username": "delete_target", "password": "Student2026"},
        ).status_code
        == 401
    )
    listed = api.client.get(
        "/api/v1/posts",
        headers=api.auth_headers,
        params={"query": "注销前的帖子"},
    )
    assert listed.status_code == 200
    assert listed.json()["items"][0]["author_name"] == "已注销用户"
    assert listed.json()["items"][0]["id"] == created.json()["id"]
    assert user["id"] != ""
