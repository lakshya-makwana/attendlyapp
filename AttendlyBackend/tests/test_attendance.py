import datetime
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient


def create_worker(client: TestClient, auth_headers: dict, name: str, daily_wage: float, effective_from: str = "2026-10-01") -> str:
    resp = client.post(
        "/api/v1/workers",
        json={"name": name, "daily_wage": daily_wage, "effective_from": effective_from},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def create_site(client: TestClient, auth_headers: dict, name: str) -> str:
    resp = client.post(
        "/api/v1/sites",
        json={"name": name},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def test_attendance_endpoints_require_authentication(client: TestClient):
    """
    Verifies that attendance endpoints reject requests without a JWT or with an invalid JWT.
    """
    assert client.get("/api/v1/attendance").status_code == 401
    assert client.post("/api/v1/attendance", json={}).status_code == 401
    assert client.get("/api/v1/attendance", headers={"Authorization": "Bearer bad.token"}).status_code == 401


def test_per_worker_independent_site_assignment_same_date(client: TestClient, auth_headers: dict):
    """
    Critical requirement:
    - Ramesh -> Metro Tower Phase 2 -> 1 work unit
    - Suresh -> Sunrise Villa 14 -> 0.5 work units
    - Amit -> Metro Tower Phase 2 -> 1.5 work units
    All on the SAME date.
    Changing one worker's site must not alter another worker's record or wage.
    """
    ramesh_id = create_worker(client, auth_headers, "Ramesh Kumar", 600.0)
    suresh_id = create_worker(client, auth_headers, "Suresh Patel", 750.0)
    amit_id = create_worker(client, auth_headers, "Amit Singh", 500.0)

    metro_site_id = create_site(client, auth_headers, "Metro Tower Phase 2")
    sunrise_site_id = create_site(client, auth_headers, "Sunrise Villa 14")

    target_date = "2026-10-15"

    # 1. Ramesh on Metro Tower (1.0 unit)
    att_ramesh = client.post(
        "/api/v1/attendance",
        json={"worker_id": ramesh_id, "site_id": metro_site_id, "date": target_date, "work_units": 1.0},
        headers=auth_headers,
    )
    assert att_ramesh.status_code == 201
    ramesh_data = att_ramesh.json()
    assert ramesh_data["site_id"] == metro_site_id
    assert ramesh_data["site_name"] == "Metro Tower Phase 2"

    # 2. Suresh on Sunrise Villa (0.5 unit)
    att_suresh = client.post(
        "/api/v1/attendance",
        json={"worker_id": suresh_id, "site_id": sunrise_site_id, "date": target_date, "work_units": 0.5},
        headers=auth_headers,
    )
    assert att_suresh.status_code == 201
    suresh_data = att_suresh.json()
    assert suresh_data["site_id"] == sunrise_site_id
    assert suresh_data["site_name"] == "Sunrise Villa 14"

    # 3. Amit on Metro Tower (1.5 units)
    att_amit = client.post(
        "/api/v1/attendance",
        json={"worker_id": amit_id, "site_id": metro_site_id, "date": target_date, "work_units": 1.5},
        headers=auth_headers,
    )
    assert att_amit.status_code == 201

    # Retrieve all attendance for that date
    date_records = client.get(f"/api/v1/attendance?date={target_date}", headers=auth_headers).json()
    assert len(date_records) == 3

    site_by_worker = {r["worker_id"]: r["site_id"] for r in date_records}
    assert site_by_worker[ramesh_id] == metro_site_id
    assert site_by_worker[suresh_id] == sunrise_site_id
    assert site_by_worker[amit_id] == metro_site_id

    # Update Ramesh's site to Sunrise Villa
    ramesh_att_id = ramesh_data["id"]
    update_resp = client.put(
        f"/api/v1/attendance/{ramesh_att_id}",
        json={"site_id": sunrise_site_id},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["site_id"] == sunrise_site_id
    assert update_resp.json()["work_units"] == 1.0  # work_units untouched

    # Verify Suresh and Amit remain completely unchanged
    suresh_check = client.get(f"/api/v1/attendance/{suresh_data['id']}", headers=auth_headers).json()
    assert suresh_check["site_id"] == sunrise_site_id
    assert suresh_check["work_units"] == 0.5


def test_allowed_work_units(client: TestClient, auth_headers: dict):
    """
    Verifies that all 5 allowed work_units values (0, 0.5, 1, 1.5, 2) succeed.
    """
    worker_id = create_worker(client, auth_headers, "Units Test Worker", 600.0)
    site_id = create_site(client, auth_headers, "Units Site")

    allowed_cases = [
        ("2026-10-01", 0.0),
        ("2026-10-02", 0.5),
        ("2026-10-03", 1.0),
        ("2026-10-04", 1.5),
        ("2026-10-05", 2.0),
    ]

    for d_str, units in allowed_cases:
        resp = client.post(
            "/api/v1/attendance",
            json={"worker_id": worker_id, "site_id": site_id, "date": d_str, "work_units": units},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["work_units"] == units


def test_invalid_work_units_rejected(client: TestClient, auth_headers: dict):
    """
    Rejects invalid work_units such as 0.75, 3.0, and -1.0.
    """
    worker_id = create_worker(client, auth_headers, "Invalid Units Worker", 500.0)
    site_id = create_site(client, auth_headers, "Invalid Units Site")

    for bad_units in [0.75, 3.0, -1.0, 1.25]:
        resp = client.post(
            "/api/v1/attendance",
            json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": bad_units},
            headers=auth_headers,
        )
        assert resp.status_code == 422


def test_duplicate_worker_date_rejected(client: TestClient, auth_headers: dict):
    """
    Prevents duplicate attendance for the same worker and date.
    Returns 409 Conflict and does not silently overwrite.
    """
    worker_id = create_worker(client, auth_headers, "Duplicate Worker", 500.0)
    site_id = create_site(client, auth_headers, "Duplicate Site")

    # First post succeeds
    resp1 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    )
    assert resp1.status_code == 201

    # Second post for same worker and date is rejected with 409
    resp2 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 0.5},
        headers=auth_headers,
    )
    assert resp2.status_code == 409
    assert "already exists" in resp2.json()["detail"]


def test_nonexistent_worker_or_site_rejected(client: TestClient, auth_headers: dict):
    """
    Rejects nonexistent worker or site IDs with 404.
    """
    site_id = create_site(client, auth_headers, "Valid Site")
    worker_id = create_worker(client, auth_headers, "Valid Worker", 500.0)

    # Fake worker
    resp1 = client.post(
        "/api/v1/attendance",
        json={"worker_id": "fake-worker-id", "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    )
    assert resp1.status_code == 404

    # Fake site
    resp2 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": "fake-site-id", "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    )
    assert resp2.status_code == 404


def test_inactive_worker_cannot_receive_new_attendance(client: TestClient, auth_headers: dict):
    """
    Rejects new attendance entries for inactive workers with 400 Bad Request.
    """
    worker_id = create_worker(client, auth_headers, "Inactive Worker", 500.0)
    site_id = create_site(client, auth_headers, "Active Site")

    # Deactivate worker
    client.post(f"/api/v1/workers/{worker_id}/deactivate", headers=auth_headers)

    # Attempt to record attendance
    resp = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "inactive worker" in resp.json()["detail"]


def test_inactive_site_cannot_receive_new_attendance(client: TestClient, auth_headers: dict):
    """
    Rejects new attendance entries for inactive sites with 400 Bad Request.
    """
    worker_id = create_worker(client, auth_headers, "Active Worker", 500.0)
    site_id = create_site(client, auth_headers, "Inactive Site")

    # Deactivate site
    client.post(f"/api/v1/sites/{site_id}/deactivate", headers=auth_headers)

    # Attempt to record attendance
    resp = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "inactive site" in resp.json()["detail"]


def test_effective_dated_wage_earnings_calculation(client: TestClient, auth_headers: dict):
    """
    Verifies that:
    1. For attendance on date D, the wage used is the latest effective_from <= D.
    2. A wage change on Oct 11 does NOT alter the wage applied on Oct 10.
    3. daily_earnings = work_units * effective_daily_wage using decimal-safe arithmetic.
    4. Updating work units recalculates earnings using the rate effective on that date.
    """
    # Worker initial wage: 500 effective Oct 1
    worker_id = create_worker(client, auth_headers, "Wage Test Worker", 500.0, effective_from="2026-10-01")
    site_id = create_site(client, auth_headers, "Wage Test Site")

    # Add mid-month wage increase to 600 effective Oct 11
    client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 600.0, "effective_from": "2026-10-11"},
        headers=auth_headers,
    )

    # Oct 10 Attendance (effective wage should be 500)
    att_oct_10 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    ).json()
    assert Decimal(str(att_oct_10["effective_daily_wage"])) == Decimal("500.00")
    assert Decimal(str(att_oct_10["daily_earnings"])) == Decimal("500.00")

    # Oct 11 Attendance (effective wage should be 600, 1.5 units = 900)
    att_oct_11 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-11", "work_units": 1.5},
        headers=auth_headers,
    ).json()
    assert Decimal(str(att_oct_11["effective_daily_wage"])) == Decimal("600.00")
    assert Decimal(str(att_oct_11["daily_earnings"])) == Decimal("900.00")

    # Oct 12 Attendance (effective wage should be 600, 0.5 units = 300)
    att_oct_12 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-12", "work_units": 0.5},
        headers=auth_headers,
    ).json()
    assert Decimal(str(att_oct_12["effective_daily_wage"])) == Decimal("600.00")
    assert Decimal(str(att_oct_12["daily_earnings"])) == Decimal("300.00")

    # Update work_units on Oct 10 from 1.0 to 1.5
    # Should recalculate earnings to 1.5 * 500 = 750 (NOT using the new 600 rate!)
    oct_10_id = att_oct_10["id"]
    updated_oct_10 = client.put(
        f"/api/v1/attendance/{oct_10_id}",
        json={"work_units": 1.5},
        headers=auth_headers,
    ).json()
    assert Decimal(str(updated_oct_10["effective_daily_wage"])) == Decimal("500.00")
    assert Decimal(str(updated_oct_10["daily_earnings"])) == Decimal("750.00")


def test_historical_records_preserved_after_worker_and_site_deactivation(client: TestClient, auth_headers: dict):
    """
    Verifies that historical attendance remains fully accessible and references intact
    even after the worker and site are deactivated.
    """
    worker_id = create_worker(client, auth_headers, "Historical Worker", 600.0)
    site_id = create_site(client, auth_headers, "Historical Site")

    att = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=auth_headers,
    ).json()
    att_id = att["id"]

    # Deactivate both worker and site
    client.post(f"/api/v1/workers/{worker_id}/deactivate", headers=auth_headers)
    client.post(f"/api/v1/sites/{site_id}/deactivate", headers=auth_headers)

    # Historical record still retrieved and intact
    fetched = client.get(f"/api/v1/attendance/{att_id}", headers=auth_headers).json()
    assert fetched["id"] == att_id
    assert fetched["worker_id"] == worker_id
    assert fetched["site_id"] == site_id
    assert fetched["worker_name"] == "Historical Worker"
    assert fetched["site_name"] == "Historical Site"
    assert fetched["work_units"] == 1.0


def test_attendance_deletion(client: TestClient, auth_headers: dict):
    """
    Verifies attendance deletion safety:
    1. Irreversible deletion of attendance records is blocked with 409 Conflict
       to safeguard financial and wage history.
    2. The record remains completely intact with its wage and earnings.
    3. Deleting a nonexistent record returns 404.
    4. Non-destructive correction via setting work_units=0 (Absent) works as intended.
    """
    worker_id = create_worker(client, auth_headers, "Delete Test Worker", 500.0)
    site_id = create_site(client, auth_headers, "Delete Test Site")

    att1 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-01", "work_units": 1.0},
        headers=auth_headers,
    ).json()

    att2 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site_id, "date": "2026-10-02", "work_units": 1.0},
        headers=auth_headers,
    ).json()

    # Attempting to delete record 1 is blocked with 409 Conflict
    del_resp = client.delete(f"/api/v1/attendance/{att1['id']}", headers=auth_headers)
    assert del_resp.status_code == 409
    assert "Permanent deletion of attendance records is disabled" in del_resp.json()["detail"]

    # Record 1 remains fully intact in the database
    fetched1 = client.get(f"/api/v1/attendance/{att1['id']}", headers=auth_headers).json()
    assert fetched1["id"] == att1["id"]
    assert fetched1["work_units"] == 1.0
    assert Decimal(str(fetched1["daily_earnings"])) == Decimal("500.00")

    # Record 2 is also untouched
    assert client.get(f"/api/v1/attendance/{att2['id']}", headers=auth_headers).status_code == 200

    # Nonexistent record returns 404
    assert client.delete("/api/v1/attendance/fake-id", headers=auth_headers).status_code == 404

    # Non-destructive correction: updating work_units to 0 (Absent) safely marks absence
    # without erasing historical attendance or date tracking
    correct_resp = client.put(
        f"/api/v1/attendance/{att1['id']}",
        json={"work_units": 0.0},
        headers=auth_headers,
    )
    assert correct_resp.status_code == 200
    corrected_data = correct_resp.json()
    assert corrected_data["work_units"] == 0.0
    assert Decimal(str(corrected_data["daily_earnings"])) == Decimal("0.00")
    assert Decimal(str(corrected_data["effective_daily_wage"])) == Decimal("500.00")


def test_absent_attendance_record_allows_nullable_site(client: TestClient, auth_headers: dict):
    """
    Verifies PWA business rule:
    Absent records (work_units = 0) allow site_id to be null/None.
    Positive work_units (>0) strictly require an active site.
    """
    worker_id = create_worker(client, auth_headers, "Absent Worker", 550.0)
    target_date = "2026-10-18"

    # 1. Recording absent with null site_id succeeds
    resp_absent = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": None, "date": target_date, "work_units": 0.0},
        headers=auth_headers,
    )
    assert resp_absent.status_code == 201
    absent_data = resp_absent.json()
    assert absent_data["work_units"] == 0.0
    assert absent_data["site_id"] is None
    assert Decimal(str(absent_data["daily_earnings"])) == Decimal("0.00")

    # 2. Recording positive work units without site_id is rejected with 400
    worker2_id = create_worker(client, auth_headers, "No Site Worker", 600.0)
    resp_bad = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker2_id, "site_id": None, "date": target_date, "work_units": 1.0},
        headers=auth_headers,
    )
    assert resp_bad.status_code == 400
    assert "Site ID is required" in resp_bad.json()["detail"]


def test_daily_attendance_roster_by_date(client: TestClient, auth_headers: dict):
    """
    Verifies GET /api/v1/attendance/by-date matches PWA roster contract:
    Returns date, total_workers, marked_count, unmarked_count, total_work_units, and workers list.
    """
    w1_id = create_worker(client, auth_headers, "Roster Worker 1", 500.0)
    w2_id = create_worker(client, auth_headers, "Roster Worker 2", 700.0)
    site_id = create_site(client, auth_headers, "Roster Site")

    target_date = "2026-10-19"

    # Mark w1 with 1.0 unit
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": target_date, "work_units": 1.0},
        headers=auth_headers,
    )

    resp = client.get(f"/api/v1/attendance/by-date?date={target_date}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["date"] == target_date
    assert data["marked_count"] >= 1
    assert Decimal(str(data["total_work_units"])) >= Decimal("1.0")

    worker_rows = {row["worker_id"]: row for row in data["workers"]}
    assert worker_rows[w1_id]["work_units"] == 1.0
    assert worker_rows[w1_id]["site_id"] == site_id
    assert worker_rows[w2_id]["work_units"] is None  # Unmarked worker


def test_batch_save_attendance(client: TestClient, auth_headers: dict):
    """
    Verifies POST /api/v1/attendance/batch-save matches PWA batch saving:
    Upserts attendance non-destructively for multiple workers on a single date.
    """
    w1_id = create_worker(client, auth_headers, "Batch Worker 1", 500.0)
    w2_id = create_worker(client, auth_headers, "Batch Worker 2", 600.0)
    site_id = create_site(client, auth_headers, "Batch Site")

    target_date = "2026-10-20"

    batch_payload = {
        "date": target_date,
        "records": [
            {"worker_id": w1_id, "site_id": site_id, "work_units": 1.0, "notes": "Full day"},
            {"worker_id": w2_id, "site_id": None, "work_units": 0.0, "notes": "Absent sick"},
        ],
    }

    save_resp = client.post("/api/v1/attendance/batch-save", json=batch_payload, headers=auth_headers)
    assert save_resp.status_code == 200
    assert "Successfully saved" in save_resp.json()["message"]

    # Verify both records saved via by-date
    roster_resp = client.get(f"/api/v1/attendance/by-date?date={target_date}", headers=auth_headers)
    assert roster_resp.status_code == 200
    roster_rows = {r["worker_id"]: r for r in roster_resp.json()["workers"]}
    assert roster_rows[w1_id]["work_units"] == 1.0
    assert roster_rows[w1_id]["site_id"] == site_id
    assert roster_rows[w2_id]["work_units"] == 0.0
    assert roster_rows[w2_id]["site_id"] is None

