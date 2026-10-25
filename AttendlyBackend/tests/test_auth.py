from datetime import timedelta
import pytest
from fastapi.testclient import TestClient
from app.core.rate_limit import login_rate_limiter
from app.core.security import create_access_token


@pytest.fixture(autouse=True)
def reset_limiter():
    login_rate_limiter.reset()
    yield
    login_rate_limiter.reset()


def test_auth_status_endpoint(client: TestClient):
    """
    Checks that /auth/status reports whether account setup has been completed.
    """
    # Before setup
    resp_before = client.get("/api/v1/auth/status")
    assert resp_before.status_code == 200
    assert resp_before.json()["is_setup"] is False

    # Perform setup
    client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "1234",
            "confirm_mpin": "1234",
        },
    )

    # After setup
    resp_after = client.get("/api/v1/auth/status")
    assert resp_after.status_code == 200
    assert resp_after.json()["is_setup"] is True


def test_account_setup_success(client: TestClient):
    """
    First-time setup succeeds with phone number + 4-digit MPIN + matching confirmation.
    Returns signed JWT and account info without exposing MPIN or hash.
    """
    response = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "1234",
            "confirm_mpin": "1234",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] > 0
    assert data["account"]["phone_number"] == "+919876543210"
    assert "mpin" not in data["account"]
    assert "mpin_hash" not in data["account"]
    assert "id" in data["account"]


def test_duplicate_account_creation_rejected(client: TestClient):
    """
    Strictly enforces one contractor account: attempting a second setup is rejected.
    """
    # First setup
    first = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "1234",
            "confirm_mpin": "1234",
        },
    )
    assert first.status_code == 201

    # Second setup attempt
    second = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919999888877",
            "mpin": "5678",
            "confirm_mpin": "5678",
        },
    )
    assert second.status_code == 400
    assert "Only one account is permitted" in second.json()["detail"]


def test_setup_mismatched_mpin_rejected(client: TestClient):
    """
    Mismatched confirm MPIN is rejected with 422 validation error.
    """
    response = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "1234",
            "confirm_mpin": "5678",
        },
    )
    assert response.status_code == 422


def test_setup_invalid_mpin_length_rejected(client: TestClient):
    """
    MPINs not exactly 4 digits (e.g. 3 digits, 5 digits, 6 digits, letters) are rejected.
    """
    # 3 digits
    resp3 = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "123",
            "confirm_mpin": "123",
        },
    )
    assert resp3.status_code == 422

    # 5 digits
    resp5 = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "12345",
            "confirm_mpin": "12345",
        },
    )
    assert resp5.status_code == 422

    # 6 digits (now rejected)
    resp6 = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "123456",
            "confirm_mpin": "123456",
        },
    )
    assert resp6.status_code == 422

    # Non-numeric
    resp_alpha = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "abcd",
            "confirm_mpin": "abcd",
        },
    )
    assert resp_alpha.status_code == 422


def test_setup_invalid_phone_rejected(client: TestClient):
    """
    Phone number with fewer than 10 digits is rejected with 422 validation error.
    """
    response = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "12345",
            "mpin": "1234",
            "confirm_mpin": "1234",
        },
    )
    assert response.status_code == 422


def test_login_success_with_mpin_only(client: TestClient):
    """
    Returning login on recognized installation requires only 4-digit MPIN.
    """
    # Create account
    client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "5678",
            "confirm_mpin": "5678",
        },
    )

    # Login with MPIN only
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"mpin": "5678"},
    )
    assert login_resp.status_code == 200
    data = login_resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["account"]["phone_number"] == "+919876543210"
    assert "mpin" not in data["account"]
    assert "mpin_hash" not in data["account"]


def test_login_incorrect_mpin_fails(client: TestClient):
    """
    Incorrect MPIN returns 401 Unauthorized with generic error.
    """
    client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "1122",
            "confirm_mpin": "1122",
        },
    )

    login_resp = client.post(
        "/api/v1/auth/login",
        json={"mpin": "9988"},
    )
    assert login_resp.status_code == 401
    assert "Invalid credentials" in login_resp.json()["detail"]


def test_login_when_no_account_exists(client: TestClient):
    """
    Login attempt before setup returns 400 Bad Request.
    """
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"mpin": "1234"},
    )
    assert login_resp.status_code == 400
    assert "No account exists" in login_resp.json()["detail"]


def test_rate_limiting_brute_force_lockout(client: TestClient):
    """
    Verifies that 5 consecutive failed login attempts trigger HTTP 429 lockout.
    """
    client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "1234",
            "confirm_mpin": "1234",
        },
    )

    # 4 failed attempts: 401
    for _ in range(4):
        resp = client.post("/api/v1/auth/login", json={"mpin": "0000"})
        assert resp.status_code == 401

    # 5th failed attempt: triggers lockout (429)
    resp5 = client.post("/api/v1/auth/login", json={"mpin": "0000"})
    assert resp5.status_code == 429
    assert "Too many failed login attempts" in resp5.json()["detail"]
    assert "Retry-After" in resp5.headers

    # 6th attempt while locked: immediately 429
    resp6 = client.post("/api/v1/auth/login", json={"mpin": "1234"})
    assert resp6.status_code == 429


def test_protected_me_endpoint_with_valid_token(client: TestClient):
    """
    GET /api/v1/auth/me and GET /api/auth/me return authenticated contractor details.
    """
    setup_data = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "1234",
            "confirm_mpin": "1234",
        },
    ).json()
    token = setup_data["access_token"]

    # Test /api/v1/auth/me
    resp1 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp1.status_code == 200
    assert resp1.json()["phone_number"] == "+919876543210"
    assert "mpin" not in resp1.json()
    assert "mpin_hash" not in resp1.json()

    # Test /api/auth/me
    resp2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp2.status_code == 200
    assert resp2.json()["phone_number"] == "+919876543210"


def test_protected_me_endpoint_rejects_missing_token(client: TestClient):
    """
    GET /api/v1/auth/me without token returns 401 Unauthorized.
    """
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert "Missing authentication credentials" in response.json()["detail"]


def test_protected_me_endpoint_rejects_invalid_token(client: TestClient):
    """
    GET /api/v1/auth/me with malformed or tampered token returns 401 Unauthorized.
    """
    response = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer invalid.fake.token"})
    assert response.status_code == 401
    assert "Invalid or expired token" in response.json()["detail"]


def test_protected_me_endpoint_rejects_expired_token(client: TestClient):
    """
    GET /api/v1/auth/me with expired token returns 401 Unauthorized.
    """
    # Create account
    setup_data = client.post(
        "/api/v1/auth/setup",
        json={
            "phone_number": "+919876543210",
            "mpin": "1234",
            "confirm_mpin": "1234",
        },
    ).json()
    account_id = setup_data["account"]["id"]

    # Generate an expired token
    expired_token = create_access_token(subject=account_id, expires_delta=timedelta(seconds=-10))

    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired_token}"})
    assert response.status_code == 401
    assert "Invalid or expired token" in response.json()["detail"]
