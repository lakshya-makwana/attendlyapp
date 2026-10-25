import pytest
from fastapi.testclient import TestClient


def test_sync_endpoints_require_authentication(client: TestClient):
    """
    Verifies that sync endpoints strictly reject unauthenticated requests.
    """
    assert client.get("/api/v1/sync/pull").status_code == 401
    assert client.post("/api/v1/sync/push", json={}).status_code == 401
    assert (
        client.get(
            "/api/v1/sync/pull", headers={"Authorization": "Bearer invalid.jwt.token"}
        ).status_code
        == 401
    )


def test_sync_push_and_pull(client: TestClient, auth_headers: dict):
    """
    Verifies that offline sync push persists workers, sites, and attendance,
    and sync pull returns the updated server state.
    """
    push_payload = {
        "sites": [
            {"id": "site-uuid-1", "name": "Sync Site 1", "active": True},
        ],
        "workers": [
            {"id": "worker-uuid-1", "name": "Sync Worker 1", "daily_wage": 700.0, "active": True},
        ],
        "attendance": [
            {
                "id": "att-uuid-1",
                "worker_id": "worker-uuid-1",
                "site_id": "site-uuid-1",
                "date": "2026-10-02",
                "work_units": 1.0,
            }
        ],
        "advances": [],
    }

    # 1. Push batch from offline queue
    push_resp = client.post("/api/v1/sync/push", json=push_payload, headers=auth_headers)
    assert push_resp.status_code == 200
    push_data = push_resp.json()
    assert push_data["success"] is True
    assert push_data["synced_workers"] == 1
    assert push_data["synced_sites"] == 1
    assert push_data["synced_attendance"] == 1
    assert len(push_data["errors"]) == 0

    # 2. Pull server state
    pull_resp = client.get("/api/v1/sync/pull", headers=auth_headers)
    assert pull_resp.status_code == 200
    pull_data = pull_resp.json()
    assert len(pull_data["workers"]) == 1
    assert len(pull_data["sites"]) == 1
    assert len(pull_data["attendance"]) == 1
    assert pull_data["workers"][0]["name"] == "Sync Worker 1"
    assert pull_data["sites"][0]["name"] == "Sync Site 1"
    assert pull_data["attendance"][0]["work_units"] == 1.0


def test_sync_push_idempotency_duplicate_prevention(client: TestClient, auth_headers: dict):
    """
    Verifies that retrying an offline push operation does NOT create duplicate records
    or cause database constraint errors.
    """
    site_payload = {"id": "site-idemp-1", "name": "Idempotent Site", "active": True}
    worker_payload = {"id": "worker-idemp-1", "name": "Idempotent Worker", "daily_wage": 600.0, "active": True}
    att_payload = {
        "id": "att-idemp-1",
        "worker_id": "worker-idemp-1",
        "site_id": "site-idemp-1",
        "date": "2026-10-05",
        "work_units": 1.0,
    }

    push_payload = {
        "sites": [site_payload],
        "workers": [worker_payload],
        "attendance": [att_payload],
    }

    # First push
    resp1 = client.post("/api/v1/sync/push", json=push_payload, headers=auth_headers)
    assert resp1.status_code == 200
    assert resp1.json()["success"] is True

    # Immediate retry of identical payload (e.g., interrupted network or retry queue)
    resp2 = client.post("/api/v1/sync/push", json=push_payload, headers=auth_headers)
    assert resp2.status_code == 200
    assert resp2.json()["success"] is True

    # Verify database has exactly 1 worker, 1 site, 1 attendance (0 duplicates created)
    pull_resp = client.get("/api/v1/sync/pull", headers=auth_headers)
    assert pull_resp.status_code == 200
    pull_data = pull_resp.json()

    matching_workers = [w for w in pull_data["workers"] if w["id"] == "worker-idemp-1"]
    matching_sites = [s for s in pull_data["sites"] if s["id"] == "site-idemp-1"]
    matching_att = [a for a in pull_data["attendance"] if a["worker_id"] == "worker-idemp-1" and a["date"] == "2026-10-05"]

    assert len(matching_workers) == 1
    assert len(matching_sites) == 1
    assert len(matching_att) == 1
