from sqlalchemy import func, select

from campus_wall_api.access_control import bootstrap_super_admin, get_user_roles
from campus_wall_api.config import DEVELOPMENT_JWT_SECRET, Settings
from campus_wall_api.models import AuditLog, User
from campus_wall_api.security import verify_password

ADMIN_PASSWORD = "zongrui2"
NEW_ADMIN_PASSWORD = "Zongrui2026"


def bootstrap_admin(api):
    return bootstrap_super_admin(
        api.session_factory,
        username="admin",
        password=ADMIN_PASSWORD,
    )


def login(api, username: str, password: str):
    return api.client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )


def authorization(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_student(api, username: str = "student01"):
    return api.client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "password": "Student2026",
            "display_name": "测试学生",
            "email": f"{username}@example.edu",
        },
    )


def test_bootstrap_admin_is_idempotent_and_never_stores_plaintext(api):
    first = bootstrap_admin(api)
    second = bootstrap_admin(api)

    assert first.model_dump() == {
        "username": "admin",
        "created": True,
        "role": "super_admin",
        "must_change_password": True,
    }
    assert second.created is False

    with api.session_factory() as session, session.begin():
        user = session.scalar(select(User).where(User.normalized_username == "admin"))
        assert user is not None
        assert user.password_hash != ADMIN_PASSWORD
        assert verify_password(ADMIN_PASSWORD, user.password_hash)[0] is True
        assert get_user_roles(session, user.id) == ["student", "super_admin"]
        audit_count = session.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.action == "identity.bootstrap_super_admin"
            )
        )
        assert audit_count == 1


def test_admin_login_and_me_expose_current_rbac_without_password_data(api):
    bootstrap_admin(api)

    response = login(api, "ADMIN", ADMIN_PASSWORD)

    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] == 900
    assert payload["user"]["must_change_password"] is True
    assert payload["user"]["roles"] == ["student", "super_admin"]
    assert "roles:assign" in payload["user"]["permissions"]
    assert "password_hash" not in response.text

    me = api.client.get(
        "/api/v1/auth/me",
        headers=authorization(payload["access_token"]),
    )
    assert me.status_code == 200
    assert me.json()["username"] == "admin"


def test_registration_normalizes_identity_and_rejects_duplicates(api):
    created = register_student(api)
    duplicate = api.client.post(
        "/api/v1/auth/register",
        json={
            "username": "STUDENT01",
            "password": "Different2026",
            "display_name": "重复学生",
            "email": "other@example.edu",
        },
    )
    weak = api.client.post(
        "/api/v1/auth/register",
        json={
            "username": "student02",
            "password": "password",
            "display_name": "弱密码学生",
        },
    )

    assert created.status_code == 201
    assert created.json()["roles"] == ["student"]
    assert duplicate.status_code == 409
    assert weak.status_code == 422
    assert weak.json()["detail"]["code"] == "weak_password"


def test_password_change_clears_bootstrap_flag_and_revokes_existing_sessions(api):
    bootstrap_admin(api)
    signed_in = login(api, "admin", ADMIN_PASSWORD).json()

    changed = api.client.post(
        "/api/v1/auth/change-password",
        headers=authorization(signed_in["access_token"]),
        json={
            "current_password": ADMIN_PASSWORD,
            "new_password": NEW_ADMIN_PASSWORD,
        },
    )

    assert changed.status_code == 204
    assert (
        api.client.get(
            "/api/v1/auth/me",
            headers=authorization(signed_in["access_token"]),
        ).status_code
        == 401
    )
    assert login(api, "admin", ADMIN_PASSWORD).status_code == 401
    new_login = login(api, "admin", NEW_ADMIN_PASSWORD)
    assert new_login.status_code == 200
    assert new_login.json()["user"]["must_change_password"] is False


def test_refresh_tokens_rotate_once_and_logout_revokes_access(api):
    bootstrap_admin(api)
    first = login(api, "admin", ADMIN_PASSWORD).json()

    rotated = api.client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": first["refresh_token"]},
    )

    assert rotated.status_code == 200
    second = rotated.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert (
        api.client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": first["refresh_token"]},
        ).status_code
        == 401
    )
    assert (
        api.client.get(
            "/api/v1/auth/me",
            headers=authorization(second["access_token"]),
        ).status_code
        == 200
    )
    assert (
        api.client.post(
            "/api/v1/auth/logout",
            headers=authorization(second["access_token"]),
        ).status_code
        == 204
    )
    assert (
        api.client.get(
            "/api/v1/auth/me",
            headers=authorization(second["access_token"]),
        ).status_code
        == 401
    )


def test_super_admin_can_assign_admin_and_students_cannot(api):
    bootstrap_admin(api)
    student = register_student(api).json()
    register_student(api, "student02")
    admin_token = login(api, "admin", ADMIN_PASSWORD).json()["access_token"]
    student_token = login(api, "student01", "Student2026").json()["access_token"]

    forbidden = api.client.put(
        f"/api/v1/admin/users/{student['id']}/roles/moderator",
        headers=authorization(student_token),
    )
    forced_change = api.client.put(
        f"/api/v1/admin/users/{student['id']}/roles/admin",
        headers=authorization(admin_token),
    )
    changed = api.client.post(
        "/api/v1/auth/change-password",
        headers=authorization(admin_token),
        json={
            "current_password": ADMIN_PASSWORD,
            "new_password": NEW_ADMIN_PASSWORD,
        },
    )
    assert changed.status_code == 204
    admin_token = login(api, "admin", NEW_ADMIN_PASSWORD).json()["access_token"]
    granted = api.client.put(
        f"/api/v1/admin/users/{student['id']}/roles/admin",
        headers=authorization(admin_token),
    )
    listed = api.client.get(
        "/api/v1/admin/users",
        headers=authorization(admin_token),
    )

    assert forbidden.status_code == 403
    assert forced_change.status_code == 403
    assert granted.status_code == 200
    assert granted.json()["roles"] == ["admin", "student"]
    assert listed.status_code == 200
    assert listed.json()["total"] == 4

    promoted_token = login(api, "student01", "Student2026").json()["access_token"]
    target = next(item for item in listed.json()["items"] if item["username"] == "student02")
    cannot_grant_peer_admin = api.client.put(
        f"/api/v1/admin/users/{target['id']}/roles/admin",
        headers=authorization(promoted_token),
    )
    assert cannot_grant_peer_admin.status_code == 403

    revoked = api.client.delete(
        f"/api/v1/admin/users/{student['id']}/roles/admin",
        headers=authorization(admin_token),
    )
    assert revoked.status_code == 200
    assert revoked.json()["roles"] == ["student"]


def test_repeated_login_failures_lock_the_account(api):
    register_student(api)

    for _ in range(5):
        assert login(api, "student01", "WrongPass1").status_code == 401

    locked = login(api, "student01", "Student2026")
    assert locked.status_code == 429


def test_production_settings_reject_default_secret_and_insecure_cors():
    try:
        Settings(
            app_env="production",
            jwt_secret=DEVELOPMENT_JWT_SECRET,
            cors_origins="https://wall.example.edu",
        )
    except ValueError as exc:
        assert "JWT_SECRET" in str(exc)
    else:
        raise AssertionError("production accepted the development JWT secret")

    try:
        Settings(
            app_env="production",
            jwt_secret="a-production-secret-that-is-long-enough",
            pii_hash_secret="a-separate-pii-secret-that-is-long-enough",
            cron_secret="a-separate-cron-secret-that-is-long-enough",
            cors_origins="*",
        )
    except ValueError as exc:
        assert "CORS_ORIGINS" in str(exc)
    else:
        raise AssertionError("production accepted wildcard CORS")

    try:
        Settings(
            app_env="production",
            jwt_secret="same-production-secret-that-is-long-enough",
            pii_hash_secret="same-production-secret-that-is-long-enough",
            cron_secret="a-separate-cron-secret-that-is-long-enough",
            cors_origins="https://wall.example.edu",
        )
    except ValueError as exc:
        assert "PII_HASH_SECRET" in str(exc)
    else:
        raise AssertionError("production accepted a reused PII hash secret")
