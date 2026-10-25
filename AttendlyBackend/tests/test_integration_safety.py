import datetime
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.models.worker import Worker
from app.models.site import Site
from app.models.attendance import Attendance
from app.models.worker_wage_history import WorkerWageHistory


def create_worker(client: TestClient, auth_headers: dict, name: str, daily_wage: float, effective_from: str = "2026-10-01") -> str:
    resp = client.post(
        "/api/v1/workers",
        json={"name": name, "daily_wage": daily_wage, "effective_from": effective_from, "active": True},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def create_site(client: TestClient, auth_headers: dict, name: str) -> str:
    resp = client.post(
        "/api/v1/sites",
        json={"name": name, "active": True},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


# ==============================================================================
# 1. Attendance deletion safety
# ==============================================================================
def test_attendance_deletion_safety_safeguards_financial_history(client: TestClient, auth_headers: dict):
    """
    Verifies that DELETE /api/v1/attendance/{id} returns HTTP 409 Conflict to
    prevent permanent loss of financial history, and verifies that updating
    work_units to 0 (Absent) is the safe non-destructive correction workflow.
    """
    worker_id = create_worker(client, auth_headers, "Safety Worker", 600.0)
    site_id = create_site(client, auth_headers, "Safety Site")

    att_resp = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    )
    assert att_resp.status_code == 201
    att_id = att_resp.json()["id"]

    # DELETE must be blocked
    del_resp = client.delete(f"/api/v1/attendance/{att_id}", headers=auth_headers)
    assert del_resp.status_code == 409
    assert "Permanent deletion of attendance records is disabled" in del_resp.json()["detail"]

    # Verify record was NOT removed from database
    get_resp = client.get(f"/api/v1/attendance/{att_id}", headers=auth_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == att_id
    assert Decimal(str(get_resp.json()["daily_earnings"])) == Decimal("600.00")

    # Deleting nonexistent record returns 404
    fake_del = client.delete("/api/v1/attendance/00000000-0000-0000-0000-000000000000", headers=auth_headers)
    assert fake_del.status_code == 404

    # Safe correction: update work_units to 0 (Absent)
    corr_resp = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"work_units": 0.0},
        headers=auth_headers,
    )
    assert corr_resp.status_code == 200
    assert corr_resp.json()["work_units"] == 0.0
    assert Decimal(str(corr_resp.json()["daily_earnings"])) == Decimal("0.00")
    assert Decimal(str(corr_resp.json()["effective_daily_wage"])) == Decimal("600.00")


# ==============================================================================
# 2. Updating attendance date recalculates effective wage and earnings
# ==============================================================================
def test_updating_attendance_date_recalculates_effective_wage_and_earnings(client: TestClient, auth_headers: dict):
    """
    Verifies that when an attendance date is updated to a date with a different
    effective wage, the wage and daily earnings are recalculated using the new date's rate.
    Also verifies rejection if the target date has no applicable wage rate.
    """
    worker_id = create_worker(client, auth_headers, "Recalc Worker", 500.0, effective_from="2026-10-01")
    site_id = create_site(client, auth_headers, "Recalc Site")

    # Add mid-month wage increase to 750 effective Oct 15
    client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 750.0, "effective_from": "2026-10-15"},
        headers=auth_headers,
    )

    # Attendance on Oct 10: 1.0 work unit -> wage 500.00, earnings 500.00
    att = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    ).json()
    att_id = att["id"]
    assert Decimal(str(att["effective_daily_wage"])) == Decimal("500.00")
    assert Decimal(str(att["daily_earnings"])) == Decimal("500.00")

    # Move attendance date to Oct 16: effective wage becomes 750.00, earnings become 750.00
    update_16 = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"date": "2026-10-16"},
        headers=auth_headers,
    )
    assert update_16.status_code == 200
    data_16 = update_16.json()
    assert data_16["date"] == "2026-10-16"
    assert Decimal(str(data_16["effective_daily_wage"])) == Decimal("750.00")
    assert Decimal(str(data_16["daily_earnings"])) == Decimal("750.00")

    # Move attendance date back to Oct 05: effective wage becomes 500.00, earnings become 500.00
    update_05 = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"date": "2026-10-05"},
        headers=auth_headers,
    )
    assert update_05.status_code == 200
    data_05 = update_05.json()
    assert data_05["date"] == "2026-10-05"
    assert Decimal(str(data_05["effective_daily_wage"])) == Decimal("500.00")
    assert Decimal(str(data_05["daily_earnings"])) == Decimal("500.00")

    # Move to date prior to any wage history (e.g., 2026-09-15) -> must be rejected
    update_sep = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"date": "2026-09-15"},
        headers=auth_headers,
    )
    assert update_sep.status_code == 400
    assert "No applicable wage rate found" in update_sep.json()["detail"]

    # Verify record remained untouched at 2026-10-05
    check_att = client.get(f"/api/v1/attendance/{att_id}", headers=auth_headers).json()
    assert check_att["date"] == "2026-10-05"


# ==============================================================================
# 3. Editing historical attendance when its site is deactivated (site unchanged)
# ==============================================================================
def test_editing_historical_attendance_when_site_inactive_is_permitted(client: TestClient, auth_headers: dict):
    """
    A historical attendance record should NOT become impossible to correct
    merely because its site was deactivated later. If the site is unchanged,
    updating work_units or date must succeed.
    """
    worker_id = create_worker(client, auth_headers, "Site Deact Worker", 600.0)
    site_id = create_site(client, auth_headers, "Site To Be Deactivated")

    att = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-05", "work_units": 1.0},
        headers=auth_headers,
    ).json()
    att_id = att["id"]

    # Deactivate the site
    deact_resp = client.post(f"/api/v1/sites/{site_id}/deactivate", headers=auth_headers)
    assert deact_resp.status_code == 200
    assert deact_resp.json()["active"] is False

    # Contractor corrects work_units to 0.5 without changing site_id
    edit_resp = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"work_units": 0.5},
        headers=auth_headers,
    )
    assert edit_resp.status_code == 200
    edited = edit_resp.json()
    assert edited["site_id"] == site_id
    assert edited["work_units"] == 0.5
    assert Decimal(str(edited["daily_earnings"])) == Decimal("300.00")

    # Contractor can also send the same site_id explicitly
    edit_resp2 = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"site_id": site_id, "work_units": 1.5},
        headers=auth_headers,
    )
    assert edit_resp2.status_code == 200
    assert edit_resp2.json()["work_units"] == 1.5
    assert Decimal(str(edit_resp2.json()["daily_earnings"])) == Decimal("900.00")


# ==============================================================================
# 4. Rejection of newly assigned inactive sites
# ==============================================================================
def test_rejection_of_newly_assigned_inactive_site_on_update(client: TestClient, auth_headers: dict):
    """
    While editing an existing record referencing an inactive site is permitted
    if the site is unchanged, switching an attendance record to a DIFFERENT
    inactive site must be strictly rejected with HTTP 400.
    """
    worker_id = create_worker(client, auth_headers, "Switch Site Worker", 500.0)
    site_a = create_site(client, auth_headers, "Active Site A")
    site_b = create_site(client, auth_headers, "Inactive Site B")

    # Deactivate Site B
    client.post(f"/api/v1/sites/{site_b}/deactivate", headers=auth_headers)

    # Record attendance on Site A
    att = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_a, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    ).json()
    att_id = att["id"]

    # Attempt to change site to inactive Site B
    switch_resp = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"site_id": site_b},
        headers=auth_headers,
    )
    assert switch_resp.status_code == 400
    assert "Cannot assign an inactive site" in switch_resp.json()["detail"]

    # Verify site remains Site A
    current_att = client.get(f"/api/v1/attendance/{att_id}", headers=auth_headers).json()
    assert current_att["site_id"] == site_a


# ==============================================================================
# 5. Duplicate records and conflicting updates
# ==============================================================================
def test_duplicate_records_and_conflicting_updates(client: TestClient, auth_headers: dict):
    """
    Verifies that:
    1. Creating a second record for the same worker and date returns 409 Conflict.
    2. Updating a record's date to a date where the worker already has attendance returns 409 Conflict.
    3. The conflicting record is left untouched.
    """
    worker_id = create_worker(client, auth_headers, "Conflict Worker", 500.0)
    site_id = create_site(client, auth_headers, "Conflict Site")

    # Record 1 on 2026-10-10
    att1 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    ).json()

    # Record 2 on 2026-10-11
    att2 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-11", "work_units": 0.5},
        headers=auth_headers,
    ).json()

    # 1. Duplicate POST on 2026-10-10
    dup_post = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.5},
        headers=auth_headers,
    )
    assert dup_post.status_code == 409
    assert "already exists" in dup_post.json()["detail"]

    # 2. Conflicting PUT: Move Record 2's date to 2026-10-10
    conflict_put = client.put(
        f"/api/v1/attendance/{att2['id']}",
        json={"date": "2026-10-10"},
        headers=auth_headers,
    )
    assert conflict_put.status_code == 409
    assert "already exists for this worker on the target date" in conflict_put.json()["detail"]

    # 3. Verify Record 2 remained on 2026-10-11
    check_att2 = client.get(f"/api/v1/attendance/{att2['id']}", headers=auth_headers).json()
    assert check_att2["date"] == "2026-10-11"
    assert check_att2["work_units"] == 0.5


# ==============================================================================
# 6. Worker/site deactivation preserving historical records & foreign keys
# ==============================================================================
def test_worker_and_site_deactivation_preserves_historical_records_and_fk_restricts(client: TestClient, auth_headers: dict, db: Session):
    """
    Verifies that deactivating workers and sites:
    1. Preserves all historical attendance and wage history.
    2. Retains original foreign key relationships.
    3. Prevents hard SQL deletion of sites while attendance records exist (ondelete='RESTRICT').
    """
    worker_id = create_worker(client, auth_headers, "FK Worker", 600.0, effective_from="2026-10-01")
    site_id = create_site(client, auth_headers, "FK Site")

    # Add second wage history entry
    client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 700.0, "effective_from": "2026-10-15"},
        headers=auth_headers,
    )

    # Record attendance
    att = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    ).json()
    att_id = att["id"]

    # Deactivate both worker and site
    client.post(f"/api/v1/workers/{worker_id}/deactivate", headers=auth_headers)
    client.post(f"/api/v1/sites/{site_id}/deactivate", headers=auth_headers)

    # Verify historical attendance is still retrieved via list and detail endpoints
    list_resp = client.get("/api/v1/attendance?date=2026-10-10", headers=auth_headers).json()
    matching = [r for r in list_resp if r["id"] == att_id]
    assert len(matching) == 1
    assert matching[0]["worker_name"] == "FK Worker"
    assert matching[0]["site_name"] == "FK Site"
    assert matching[0]["worker"]["active"] is False
    assert matching[0]["site"]["active"] is False

    # Verify worker wage history is preserved
    wages = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers).json()
    assert len(wages) == 2

    # Verify database foreign key restriction: hard delete of site is blocked by database
    with pytest.raises(Exception):
        db.execute(text(f"DELETE FROM sites WHERE id = '{site_id}'"))
        db.flush()
    db.rollback()


# ==============================================================================
# 7. Authentication protection across all private endpoints
# ==============================================================================
def test_all_private_endpoints_require_valid_jwt(client: TestClient):
    """
    Verifies that every business endpoint rejects requests without a token or with an invalid token.
    """
    endpoints = [
        ("GET", "/api/v1/workers"),
        ("POST", "/api/v1/workers", {"name": "Test", "daily_wage": 500.0}),
        ("GET", "/api/v1/workers/some-id"),
        ("PUT", "/api/v1/workers/some-id", {"name": "Test"}),
        ("POST", "/api/v1/workers/some-id/deactivate"),
        ("POST", "/api/v1/workers/some-id/reactivate"),
        ("GET", "/api/v1/workers/some-id/wages"),
        ("POST", "/api/v1/workers/some-id/wages", {"daily_wage": 600.0, "effective_from": "2026-10-01"}),
        ("GET", "/api/v1/sites"),
        ("POST", "/api/v1/sites", {"name": "Site"}),
        ("GET", "/api/v1/sites/some-id"),
        ("PUT", "/api/v1/sites/some-id", {"name": "Site"}),
        ("POST", "/api/v1/sites/some-id/deactivate"),
        ("POST", "/api/v1/sites/some-id/reactivate"),
        ("GET", "/api/v1/attendance"),
        ("POST", "/api/v1/attendance", {"worker_id": "w", "site_id": "s", "date": "2026-10-01", "work_units": 1.0}),
        ("GET", "/api/v1/attendance/some-id"),
        ("GET", "/api/v1/attendance/worker/some-id"),
        ("PUT", "/api/v1/attendance/some-id", {"work_units": 0.5}),
        ("DELETE", "/api/v1/attendance/some-id"),
        ("GET", "/api/v1/auth/me"),
    ]

    for item in endpoints:
        method = item[0]
        url = item[1]
        payload = item[2] if len(item) > 2 else None

        # 1. No token
        if method == "GET":
            resp_no_token = client.get(url)
        elif method == "POST":
            resp_no_token = client.post(url, json=payload or {})
        elif method == "PUT":
            resp_no_token = client.put(url, json=payload or {})
        elif method == "DELETE":
            resp_no_token = client.delete(url)
        assert resp_no_token.status_code == 401, f"{method} {url} without token returned {resp_no_token.status_code}"

        # 2. Invalid token
        bad_headers = {"Authorization": "Bearer bad.token.value"}
        if method == "GET":
            resp_bad_token = client.get(url, headers=bad_headers)
        elif method == "POST":
            resp_bad_token = client.post(url, json=payload or {}, headers=bad_headers)
        elif method == "PUT":
            resp_bad_token = client.put(url, json=payload or {}, headers=bad_headers)
        elif method == "DELETE":
            resp_bad_token = client.delete(url, headers=bad_headers)
        assert resp_bad_token.status_code == 401, f"{method} {url} with bad token returned {resp_bad_token.status_code}"


# ==============================================================================
# 8. Failed requests leave data unchanged
# ==============================================================================
def test_failed_requests_leave_database_unchanged(client: TestClient, auth_headers: dict):
    """
    Verifies that requests failing validation, integrity checks, or business rules
    do not leave partially modified or corrupted state in the database.
    """
    worker_id = create_worker(client, auth_headers, "Unchanged Worker", 500.0)
    site_id = create_site(client, auth_headers, "Unchanged Site")

    att = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    ).json()
    att_id = att["id"]

    # 1. Attempt update with invalid work_units: 0.75 (validation error 422)
    resp_invalid_units = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"work_units": 0.75},
        headers=auth_headers,
    )
    assert resp_invalid_units.status_code == 422

    # Check record is still 1.0 work units
    fetched = client.get(f"/api/v1/attendance/{att_id}", headers=auth_headers).json()
    assert fetched["work_units"] == 1.0
    assert fetched["date"] == "2026-10-10"

    # 2. Attempt update with nonexistent site (404)
    resp_bad_site = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"site_id": "nonexistent-site-id"},
        headers=auth_headers,
    )
    assert resp_bad_site.status_code == 404

    # Check record still has original site
    fetched = client.get(f"/api/v1/attendance/{att_id}", headers=auth_headers).json()
    assert fetched["site_id"] == site_id

    # 3. Attempt update with invalid date prior to wage history (400)
    resp_bad_date = client.put(
        f"/api/v1/attendance/{att_id}",
        json={"date": "2026-08-01"},
        headers=auth_headers,
    )
    assert resp_bad_date.status_code == 400

    # Check record still has original date and wage
    fetched = client.get(f"/api/v1/attendance/{att_id}", headers=auth_headers).json()
    assert fetched["date"] == "2026-10-10"
    assert Decimal(str(fetched["effective_daily_wage"])) == Decimal("500.00")
