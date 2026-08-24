from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from campus_wall_api.models import AuditLog, UserRole


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


def event_payload(**overrides) -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "title": "校园机器人体验日",
        "description": "面向全校同学开放机器人编程体验、作品展示和安全操作讲解。",
        "location": "科技楼一层创客空间",
        "starts_at": (now + timedelta(hours=1)).isoformat(),
        "ends_at": (now + timedelta(hours=3)).isoformat(),
        "registration_deadline": (now + timedelta(minutes=30)).isoformat(),
        "capacity": 1,
        "status": "published",
        "check_in_code": "ROBOT-2026",
        **overrides,
    }


def test_verified_club_membership_announcement_and_event_lifecycle(api):
    applicant_headers, applicant_id = register_and_login(api, "club_applicant")
    second_headers, second_id = register_and_login(api, "club_second")
    third_headers, third_id = register_and_login(api, "club_third")
    moderator_headers, moderator_id = register_and_login(api, "club_moderator")
    with api.session_factory() as session, session.begin():
        session.add(UserRole(user_id=moderator_id, role_name="moderator"))

    created = api.client.post(
        "/api/v1/clubs",
        headers=api.auth_headers,
        json={
            "name": "观澜机器人社",
            "slug": "guanlan-robotics",
            "description": "为同学提供机器人结构设计、编程实践和校内科创交流活动。",
            "recruitment_status": "open",
            "member_limit": 3,
        },
    )
    assert created.status_code == 201, created.text
    club = created.json()
    club_id = club["id"]
    assert club["status"] == "pending"
    assert club["membership_role"] == "owner"
    assert club["membership_status"] == "active"
    assert club["member_count"] == 1
    assert club["can_manage"] is True

    forbidden_review_queue = api.client.get(
        "/api/v1/clubs",
        headers=applicant_headers,
        params={"review_queue": "true"},
    )
    assert forbidden_review_queue.status_code == 403
    review_queue = api.client.get(
        "/api/v1/clubs",
        headers=moderator_headers,
        params={"review_queue": "true"},
    )
    assert [item["id"] for item in review_queue.json()["items"]] == [club_id]

    duplicate_slug = api.client.post(
        "/api/v1/clubs",
        headers=applicant_headers,
        json={
            "name": "重名机器人社",
            "slug": "guanlan-robotics",
            "description": "这个申请使用了已经存在的社团短链接，因此不能重复创建。",
        },
    )
    assert duplicate_slug.status_code == 409
    assert duplicate_slug.json()["detail"]["code"] == "club_slug_exists"

    assert api.client.get("/api/v1/clubs", headers=applicant_headers).json()["items"] == []
    assert api.client.get(f"/api/v1/clubs/{club_id}", headers=applicant_headers).status_code == 404
    assert (
        api.client.post(
            f"/api/v1/clubs/{club_id}/announcements",
            headers=api.auth_headers,
            json={"title": "暂不可发布", "body": "未认证社团不能发布公开公告。"},
        ).status_code
        == 409
    )
    assert (
        api.client.post(
            f"/api/v1/clubs/{club_id}/events",
            headers=api.auth_headers,
            json=event_payload(status="draft"),
        ).status_code
        == 409
    )
    assert (
        api.client.post(
            f"/api/v1/clubs/{club_id}/memberships",
            headers=applicant_headers,
            json={"message": "我想参加机器人编程和结构设计活动。"},
        ).status_code
        == 409
    )

    forbidden_verification = api.client.patch(
        f"/api/v1/clubs/{club_id}/verification",
        headers=applicant_headers,
        json={"status": "verified", "note": "普通学生不能自行认证社团。"},
    )
    assert forbidden_verification.status_code == 403

    verified = api.client.patch(
        f"/api/v1/clubs/{club_id}/verification",
        headers=moderator_headers,
        json={"status": "verified", "note": "已核验指导教师和校内活动场地。"},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "verified"
    assert verified.json()["verification_note"] == "已核验指导教师和校内活动场地。"

    visible = api.client.get(
        "/api/v1/clubs",
        headers=applicant_headers,
        params={"query": "机器人"},
    )
    assert [item["id"] for item in visible.json()["items"]] == [club_id]
    assert visible.json()["items"][0]["verification_note"] is None

    unauthorized_edit = api.client.patch(
        f"/api/v1/clubs/{club_id}",
        headers=applicant_headers,
        json={"name": "越权改名社团"},
    )
    assert unauthorized_edit.status_code == 403

    application = api.client.post(
        f"/api/v1/clubs/{club_id}/memberships",
        headers=applicant_headers,
        json={"message": "我会 Python，也愿意协助组织每周的机器人入门活动。"},
    )
    assert application.status_code == 201, application.text
    assert application.json()["status"] == "pending"
    assert application.json()["user_id"] == applicant_id

    duplicate_application = api.client.post(
        f"/api/v1/clubs/{club_id}/memberships",
        headers=applicant_headers,
        json={"message": "进行中的申请不能再次重复提交。"},
    )
    assert duplicate_application.status_code == 409

    memberships = api.client.get(
        f"/api/v1/clubs/{club_id}/memberships",
        headers=api.auth_headers,
    )
    assert memberships.status_code == 200, memberships.text
    assert {item["status"] for item in memberships.json()["items"]} == {
        "active",
        "pending",
    }

    promoted = api.client.patch(
        f"/api/v1/clubs/{club_id}/memberships/{applicant_id}",
        headers=api.auth_headers,
        json={"status": "active", "role": "manager"},
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["role"] == "manager"

    second_application = api.client.post(
        f"/api/v1/clubs/{club_id}/memberships",
        headers=second_headers,
        json={"message": "我想参加社团活动并帮助整理机器人器材和活动记录。"},
    )
    assert second_application.status_code == 201

    manager_cannot_promote = api.client.patch(
        f"/api/v1/clubs/{club_id}/memberships/{second_id}",
        headers=applicant_headers,
        json={"status": "active", "role": "manager"},
    )
    assert manager_cannot_promote.status_code == 403

    approved = api.client.patch(
        f"/api/v1/clubs/{club_id}/memberships/{second_id}",
        headers=applicant_headers,
        json={"status": "active", "role": "member"},
    )
    assert approved.status_code == 200, approved.text

    third_application = api.client.post(
        f"/api/v1/clubs/{club_id}/memberships",
        headers=third_headers,
        json={"message": "我希望学习机器人基础知识，也会遵守社团安全操作要求。"},
    )
    assert third_application.status_code == 201
    member_limit = api.client.patch(
        f"/api/v1/clubs/{club_id}/memberships/{third_id}",
        headers=api.auth_headers,
        json={"status": "active", "role": "member"},
    )
    assert member_limit.status_code == 409
    assert member_limit.json()["detail"]["code"] == "club_member_limit_reached"

    member_announcement = api.client.post(
        f"/api/v1/clubs/{club_id}/announcements",
        headers=second_headers,
        json={"title": "越权公告", "body": "普通成员不应该可以发布社团公告。"},
    )
    assert member_announcement.status_code == 403

    announcement = api.client.post(
        f"/api/v1/clubs/{club_id}/announcements",
        headers=applicant_headers,
        json={
            "title": "本周机器人开放体验",
            "body": "请参加体验的同学提前十分钟到场，并听从现场安全操作安排。",
        },
    )
    assert announcement.status_code == 201, announcement.text
    announcements = api.client.get(
        f"/api/v1/clubs/{club_id}/announcements",
        headers=second_headers,
    )
    assert announcements.status_code == 200
    assert announcements.json()["items"][0]["title"] == "本周机器人开放体验"

    event_response = api.client.post(
        f"/api/v1/clubs/{club_id}/events",
        headers=applicant_headers,
        json=event_payload(status="draft", check_in_code=None),
    )
    assert event_response.status_code == 201, event_response.text
    event = event_response.json()
    event_id = event["id"]
    assert event["status"] == "draft"
    assert event["registration_open"] is False
    assert event["check_in_configured"] is False
    assert event["check_in_open"] is False
    assert event["registered_count"] == 0
    assert event["can_manage"] is True

    hidden_draft = api.client.get(
        "/api/v1/events",
        headers=second_headers,
        params={"query": "机器人"},
    )
    assert hidden_draft.json()["items"] == []

    unauthorized_publish = api.client.patch(
        f"/api/v1/events/{event_id}",
        headers=second_headers,
        json={"status": "published", "check_in_code": "STOLEN-2026"},
    )
    assert unauthorized_publish.status_code == 403

    published = api.client.patch(
        f"/api/v1/events/{event_id}",
        headers=applicant_headers,
        json={"status": "published", "check_in_code": "ROBOT-2026"},
    )
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    assert published.json()["registration_open"] is True
    assert published.json()["check_in_configured"] is True
    assert published.json()["check_in_open"] is True

    event_feed = api.client.get(
        "/api/v1/events",
        headers=second_headers,
        params={"query": "机器人"},
    )
    assert [item["id"] for item in event_feed.json()["items"]] == [event_id]
    assert event_feed.json()["items"][0]["registration_status"] is None
    assert event_feed.json()["items"][0]["check_in_configured"] is True
    assert event_feed.json()["items"][0]["check_in_open"] is True

    registration = api.client.post(
        f"/api/v1/events/{event_id}/registrations",
        headers=second_headers,
    )
    assert registration.status_code == 201, registration.text
    assert registration.json()["status"] == "registered"

    full = api.client.post(
        f"/api/v1/events/{event_id}/registrations",
        headers=third_headers,
    )
    assert full.status_code == 409
    assert full.json()["detail"]["code"] == "event_full"

    duplicate_registration = api.client.post(
        f"/api/v1/events/{event_id}/registrations",
        headers=second_headers,
    )
    assert duplicate_registration.status_code == 409
    assert duplicate_registration.json()["detail"]["code"] == "event_registration_exists"

    cancelled = api.client.delete(
        f"/api/v1/events/{event_id}/registrations/me",
        headers=second_headers,
    )
    assert cancelled.status_code == 204

    replacement = api.client.post(
        f"/api/v1/events/{event_id}/registrations",
        headers=third_headers,
    )
    assert replacement.status_code == 201

    wrong_code = api.client.post(
        f"/api/v1/events/{event_id}/check-in",
        headers=third_headers,
        json={"code": "WRONG-2026"},
    )
    assert wrong_code.status_code == 403
    assert wrong_code.json()["detail"]["code"] == "invalid_check_in_code"

    checked_in = api.client.post(
        f"/api/v1/events/{event_id}/check-in",
        headers=third_headers,
        json={"code": "ROBOT-2026"},
    )
    assert checked_in.status_code == 200, checked_in.text
    assert checked_in.json()["status"] == "checked_in"
    assert checked_in.json()["checked_in_at"]

    attendee_cannot_list = api.client.get(
        f"/api/v1/events/{event_id}/registrations",
        headers=second_headers,
    )
    assert attendee_cannot_list.status_code == 403

    registration_list = api.client.get(
        f"/api/v1/events/{event_id}/registrations",
        headers=api.auth_headers,
    )
    assert registration_list.status_code == 200
    by_user = {item["user_id"]: item for item in registration_list.json()["items"]}
    assert by_user[second_id]["status"] == "cancelled"
    assert by_user[third_id]["status"] == "checked_in"

    cancelled_event = api.client.patch(
        f"/api/v1/events/{event_id}",
        headers=applicant_headers,
        json={"status": "cancelled"},
    )
    assert cancelled_event.status_code == 200, cancelled_event.text
    assert cancelled_event.json()["status"] == "cancelled"
    assert cancelled_event.json()["registered_count"] == 0
    assert (
        api.client.get(
            "/api/v1/events",
            headers=second_headers,
            params={"query": "机器人"},
        ).json()["items"]
        == []
    )

    cancelled_registrations = api.client.get(
        f"/api/v1/events/{event_id}/registrations",
        headers=api.auth_headers,
    ).json()["items"]
    assert {item["status"] for item in cancelled_registrations} == {"cancelled"}

    with api.session_factory() as session, session.begin():
        actions = list(
            session.scalars(
                select(AuditLog.action).where(AuditLog.target_id.in_((club_id, event_id)))
            )
        )
    assert "community.club_verified" in actions
    assert "community.event_created" in actions
    assert "community.event_checked_in" in actions


def test_club_owner_cannot_leave_and_rejected_applicant_can_reapply(api):
    applicant_headers, applicant_id = register_and_login(api, "club_reapply")
    moderator_headers, moderator_id = register_and_login(api, "club_review_moderator")
    with api.session_factory() as session, session.begin():
        session.add(UserRole(user_id=moderator_id, role_name="moderator"))

    club = api.client.post(
        "/api/v1/clubs",
        headers=api.auth_headers,
        json={
            "name": "校园摄影社",
            "slug": "campus-photography",
            "description": "组织合规的校园风景摄影、后期分享和公开活动记录，不拍摄未授权肖像。",
            "recruitment_status": "open",
        },
    ).json()
    club_id = club["id"]
    api.client.patch(
        f"/api/v1/clubs/{club_id}/verification",
        headers=moderator_headers,
        json={"status": "verified", "note": "已确认社团负责人及肖像保护规则。"},
    )

    owner_leave = api.client.delete(
        f"/api/v1/clubs/{club_id}/memberships/me",
        headers=api.auth_headers,
    )
    assert owner_leave.status_code == 409
    assert owner_leave.json()["detail"]["code"] == "club_owner_cannot_leave"

    first = api.client.post(
        f"/api/v1/clubs/{club_id}/memberships",
        headers=applicant_headers,
        json={"message": "我愿意遵守肖像授权规则并参加校园风景摄影活动。"},
    )
    assert first.status_code == 201
    rejected = api.client.patch(
        f"/api/v1/clubs/{club_id}/memberships/{applicant_id}",
        headers=api.auth_headers,
        json={"status": "rejected", "role": "member"},
    )
    assert rejected.status_code == 200

    reapplied = api.client.post(
        f"/api/v1/clubs/{club_id}/memberships",
        headers=applicant_headers,
        json={"message": "我已阅读社团规则，希望重新申请并参加后续公开活动。"},
    )
    assert reapplied.status_code == 201
    assert reapplied.json()["status"] == "pending"
    assert reapplied.json()["user_id"] == applicant_id

    left = api.client.delete(
        f"/api/v1/clubs/{club_id}/memberships/me",
        headers=applicant_headers,
    )
    assert left.status_code == 204
