import datetime
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models import Site, Attendance, Worker
from app.core.rate_limit import login_rate_limiter


def test_worker_endpoints_require_authentication(client: TestClient):
    """
    Verifies that worker endpoints reject requests without a JWT or with an invalid JWT.
    """
    # Missing token
    resp_no_token = client.get("/api/v1/workers")
    assert resp_no_token.status_code == 401

    # Invalid token
    resp_invalid_token = client.get(
        "/api/v1/workers",
        headers={"Authorization": "Bearer bad.token.here"},
    )
    assert resp_invalid_token.status_code == 401


def test_create_and_read_worker(client: TestClient, auth_headers: dict):
    """
    Verifies worker creation, initial wage history creation, and retrieval by ID.
    """
    effective_date = datetime.date(2026, 10, 1)
    resp = client.post(
        "/api/v1/workers",
        json={
            "name": "Rajesh Kumar",
            "daily_wage": 650.00,
            "effective_from": str(effective_date),
            "active": True,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Rajesh Kumar"
    assert Decimal(str(data["daily_wage"])) == Decimal("650.00")
    assert data["active"] is True
    worker_id = data["id"]

    # Retrieve worker by ID
    get_resp = client.get(f"/api/v1/workers/{worker_id}", headers=auth_headers)
    assert get_resp.status_code == 200
    retrieved = get_resp.json()
    assert retrieved["id"] == worker_id
    assert retrieved["name"] == "Rajesh Kumar"

    # Verify initial wage history entry was created
    wages_resp = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers)
    assert wages_resp.status_code == 200
    wages = wages_resp.json()
    assert len(wages) == 1
    assert Decimal(str(wages[0]["daily_wage"])) == Decimal("650.00")
    assert wages[0]["effective_from"] == "2026-10-01"


def test_worker_validation_errors(client: TestClient, auth_headers: dict):
    """
    Rejects invalid names (empty/whitespace) and negative wages.
    """
    # Empty name
    resp_empty_name = client.post(
        "/api/v1/workers",
        json={"name": "   ", "daily_wage": 500.00},
        headers=auth_headers,
    )
    assert resp_empty_name.status_code == 422

    # Negative wage
    resp_neg_wage = client.post(
        "/api/v1/workers",
        json={"name": "Valid Name", "daily_wage": -100.00},
        headers=auth_headers,
    )
    assert resp_neg_wage.status_code == 422


def test_list_workers_filtering(client: TestClient, auth_headers: dict):
    """
    Verifies that inactive workers are excluded by default and included with include_inactive=True.
    """
    # Create active worker
    w1 = client.post(
        "/api/v1/workers",
        json={"name": "Active Worker", "daily_wage": 600.00, "active": True},
        headers=auth_headers,
    ).json()

    # Create inactive worker
    w2 = client.post(
        "/api/v1/workers",
        json={"name": "Inactive Worker", "daily_wage": 550.00, "active": False},
        headers=auth_headers,
    ).json()

    # Default list: active only
    resp_active = client.get("/api/v1/workers", headers=auth_headers)
    assert resp_active.status_code == 200
    active_ids = [w["id"] for w in resp_active.json()]
    assert w1["id"] in active_ids
    assert w2["id"] not in active_ids

    # List with include_inactive=True
    resp_all = client.get("/api/v1/workers?include_inactive=true", headers=auth_headers)
    assert resp_all.status_code == 200
    all_ids = [w["id"] for w in resp_all.json()]
    assert w1["id"] in all_ids
    assert w2["id"] in all_ids


def test_update_worker_details(client: TestClient, auth_headers: dict):
    """
    Verifies updating worker name and wage with automatic wage-history tracking.
    """
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Amit Shah", "daily_wage": 500.00, "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # Update name and new wage effective Oct 15
    update_resp = client.put(
        f"/api/v1/workers/{worker_id}",
        json={
            "name": "Amit K. Shah",
            "daily_wage": 575.00,
            "effective_from": "2026-10-15",
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["name"] == "Amit K. Shah"
    assert Decimal(str(data["daily_wage"])) == Decimal("575.00")

    # Verify both wage history entries are preserved
    wages = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers).json()
    assert len(wages) == 2
    assert wages[0]["effective_from"] == "2026-10-15"
    assert Decimal(str(wages[0]["daily_wage"])) == Decimal("575.00")
    assert wages[1]["effective_from"] == "2026-10-01"
    assert Decimal(str(wages[1]["daily_wage"])) == Decimal("500.00")


def test_deactivate_and_reactivate_worker(client: TestClient, auth_headers: dict):
    """
    Verifies soft deactivation and reactivation endpoints without deleting historical records.
    """
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Karan Johar", "daily_wage": 700.00},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # Deactivate
    deact_resp = client.post(f"/api/v1/workers/{worker_id}/deactivate", headers=auth_headers)
    assert deact_resp.status_code == 200
    assert deact_resp.json()["active"] is False

    # Excluded from active list
    active_list = client.get("/api/v1/workers", headers=auth_headers).json()
    assert worker_id not in [w["id"] for w in active_list]

    # Reactivate
    react_resp = client.post(f"/api/v1/workers/{worker_id}/reactivate", headers=auth_headers)
    assert react_resp.status_code == 200
    assert react_resp.json()["active"] is True

    # Included in active list again
    active_list_again = client.get("/api/v1/workers", headers=auth_headers).json()
    assert worker_id in [w["id"] for w in active_list_again]


def test_wage_history_duplicate_effective_date_updates_rate(client: TestClient, auth_headers: dict):
    """
    Verifies that posting a wage rate with an already-existing effective date updates
    that entry instead of creating a duplicate row.
    """
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Dinesh Patel", "daily_wage": 400.00, "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # Add wage on Oct 10
    wh1 = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 450.00, "effective_from": "2026-10-10"},
        headers=auth_headers,
    )
    assert wh1.status_code == 201

    # Post update for the SAME date (Oct 10) with revised wage 480.00
    wh2 = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 480.00, "effective_from": "2026-10-10"},
        headers=auth_headers,
    )
    assert wh2.status_code == 201
    assert Decimal(str(wh2.json()["daily_wage"])) == Decimal("480.00")

    # Verify no duplicate entry exists for 2026-10-10
    wages = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers).json()
    assert len(wages) == 2  # 2026-10-10 and 2026-10-01
    assert wages[0]["effective_from"] == "2026-10-10"
    assert Decimal(str(wages[0]["daily_wage"])) == Decimal("480.00")


def test_nonexistent_worker_returns_404(client: TestClient, auth_headers: dict):
    """
    Verifies 404 for nonexistent worker queries, updates, and wage additions.
    """
    fake_id = "nonexistent-worker-id"
    assert client.get(f"/api/v1/workers/{fake_id}", headers=auth_headers).status_code == 404
    assert client.put(f"/api/v1/workers/{fake_id}", json={"name": "New"}, headers=auth_headers).status_code == 404
    assert client.post(f"/api/v1/workers/{fake_id}/deactivate", headers=auth_headers).status_code == 404
    assert client.post(f"/api/v1/workers/{fake_id}/reactivate", headers=auth_headers).status_code == 404
    assert client.get(f"/api/v1/workers/{fake_id}/wages", headers=auth_headers).status_code == 404
    assert client.post(f"/api/v1/workers/{fake_id}/wages", json={"daily_wage": 500, "effective_from": "2026-10-01"}, headers=auth_headers).status_code == 404


def test_historical_attendance_preserved_on_deactivation(client: TestClient, auth_headers: dict, db: Session):
    """
    Verifies that deactivating a worker preserves historical attendance and wage history records intact.
    """
    # Create worker
    worker_data = client.post(
        "/api/v1/workers",
        json={"name": "Ramesh Historical", "daily_wage": 600.00, "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker_data["id"]

    # Create site & attendance directly in DB
    site = Site(name="Site Historical Alpha", active=True)
    db.add(site)
    db.commit()

    att = Attendance(
        worker_id=worker_id,
        site_id=site.id,
        date=datetime.date(2026, 10, 5),
        work_units=Decimal("1.0"),
    )
    db.add(att)
    db.commit()

    # Deactivate worker
    deact_resp = client.post(f"/api/v1/workers/{worker_id}/deactivate", headers=auth_headers)
    assert deact_resp.status_code == 200

    # Verify attendance record still exists
    att_in_db = db.query(Attendance).filter(Attendance.worker_id == worker_id).first()
    assert att_in_db is not None
    assert att_in_db.date == datetime.date(2026, 10, 5)
    assert att_in_db.work_units == Decimal("1.0")

    # Verify wage history record still exists
    wages = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers).json()
    assert len(wages) == 1


def test_worker_phone_support_and_toggle_status(client: TestClient, auth_headers: dict):
    """
    Verifies that worker creation and update preserve phone number,
    and PATCH /toggle-status toggles active status.
    """
    resp = client.post(
        "/api/v1/workers",
        json={"name": "Suresh Raina", "phone": "9876543210", "daily_wage": 750.00},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["phone"] == "9876543210"
    assert data["active"] is True
    worker_id = data["id"]

    # Update phone
    update_resp = client.put(
        f"/api/v1/workers/{worker_id}",
        json={"phone": "9123456789"},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["phone"] == "9123456789"

    # Toggle status to inactive
    toggle_resp1 = client.patch(f"/api/v1/workers/{worker_id}/toggle-status", headers=auth_headers)
    assert toggle_resp1.status_code == 200
    assert toggle_resp1.json()["active"] is False

    # Toggle status back to active
    toggle_resp2 = client.patch(f"/api/v1/workers/{worker_id}/toggle-status", headers=auth_headers)
    assert toggle_resp2.status_code == 200
    assert toggle_resp2.json()["active"] is True


def test_worker_wage_deletion_and_sole_record_protection(client: TestClient, auth_headers: dict):
    """
    Verifies that deleting a worker's sole wage record is blocked with 400,
    and deleting a secondary wage record succeeds and restores current daily wage.
    """
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Vijay Shankar", "daily_wage": 500.00, "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    wages = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers).json()
    sole_wage_id = wages[0]["id"]

    # Attempt to delete sole wage record -> must fail
    del_sole = client.delete(f"/api/v1/workers/{worker_id}/wages/{sole_wage_id}", headers=auth_headers)
    assert del_sole.status_code == 400
    assert "sole wage record" in del_sole.json()["detail"].lower()

    # Add second wage record for future or today
    wh2 = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 600.00, "effective_from": "2026-10-15"},
        headers=auth_headers,
    ).json()
    wh2_id = wh2["id"]

    # Now 2 records exist
    wages2 = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers).json()
    assert len(wages2) == 2

    # Delete the newly added wage record
    del_wh2 = client.delete(f"/api/v1/workers/{worker_id}/wages/{wh2_id}", headers=auth_headers)
    assert del_wh2.status_code == 200

    # Verify only 1 remains and worker.daily_wage is restored to 500
    wages_final = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers).json()
    assert len(wages_final) == 1
    assert Decimal(str(wages_final[0]["daily_wage"])) == Decimal("500.00")

    worker_refreshed = client.get(f"/api/v1/workers/{worker_id}", headers=auth_headers).json()
    assert Decimal(str(worker_refreshed["daily_wage"])) == Decimal("500.00")


def test_effective_wage_resolution_past_and_future_dates(client: TestClient, auth_headers: dict, db: Session):
    """
    Verifies that worker.get_effective_wage(date):
    - Uses earliest recorded wage if target_date is before baseline
    - Uses latest rate on or before target_date for historical shifts
    - Applies scheduled future rate only on or after its effective_from date
    """
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Krunal Pandya", "daily_wage": 400.00, "effective_from": "2026-10-10"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # Add future rate effective Oct 20
    client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 550.00, "effective_from": "2026-10-20"},
        headers=auth_headers,
    )

    db_worker = db.query(Worker).filter(Worker.id == worker_id).first()
    assert db_worker is not None

    # Date before baseline (Oct 5) -> returns earliest recorded rate (400.00)
    assert db_worker.get_effective_wage(datetime.date(2026, 10, 5)) == Decimal("400.00")

    # Date on baseline (Oct 10) -> 400.00
    assert db_worker.get_effective_wage(datetime.date(2026, 10, 10)) == Decimal("400.00")

    # Date between Oct 10 and Oct 20 (Oct 15) -> 400.00
    assert db_worker.get_effective_wage(datetime.date(2026, 10, 15)) == Decimal("400.00")

    # Date on future effective date (Oct 20) -> 550.00
    assert db_worker.get_effective_wage(datetime.date(2026, 10, 20)) == Decimal("550.00")

    # Date after future effective date (Oct 25) -> 550.00
    assert db_worker.get_effective_wage(datetime.date(2026, 10, 25)) == Decimal("550.00")


def test_worker_detail_and_monthly_itemized_records(client: TestClient, auth_headers: dict):
    """
    Verifies GET /workers/{id}/detail and GET /workers/{id}/monthly with itemized attendance and advances.
    """
    # 1. Create worker
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Rohit Verma", "daily_wage": 650.0, "phone": "+919876599999", "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # 2. Create site
    site = client.post(
        "/api/v1/sites",
        json={"name": "Airport Terminal", "location": "Terminal 3"},
        headers=auth_headers,
    ).json()

    # 3. Add attendance
    client.post(
        "/api/v1/attendance",
        json={"worker_id": worker_id, "site_id": site["id"], "date": "2026-10-04", "work_units": 1.0},
        headers=auth_headers,
    )

    # 4. Add advance
    client.post(
        "/api/v1/advances",
        json={"worker_id": worker_id, "amount": 500.0, "date": "2026-10-05", "note": "Weekly advance"},
        headers=auth_headers,
    )

    # 5. Check GET /workers/{worker_id}/detail
    detail_resp = client.get(f"/api/v1/workers/{worker_id}/detail", headers=auth_headers)
    assert detail_resp.status_code == 200
    detail_data = detail_resp.json()
    assert detail_data["worker"]["name"] == "Rohit Verma"
    assert detail_data["worker"]["phone"] == "+919876599999"
    assert detail_data["worker"]["is_active"] is True
    assert float(detail_data["all_advances_sum"]) == 500.0
    assert len(detail_data["recent_attendance"]) == 1
    assert detail_data["recent_attendance"][0]["site_name"] == "Airport Terminal"

    # 6. Check GET /workers/{worker_id}/monthly
    monthly_resp = client.get(f"/api/v1/workers/{worker_id}/monthly?year=2026&month=10", headers=auth_headers)
    assert monthly_resp.status_code == 200
    monthly_data = monthly_resp.json()
    assert monthly_data["worker_name"] == "Rohit Verma"
    assert monthly_data["is_active"] is True
    assert float(monthly_data["total_work_units"]) == 1.0
    assert float(monthly_data["gross_earnings"]) == 650.0
    assert float(monthly_data["total_advances"]) == 500.0
    assert float(monthly_data["net_payable"]) == 150.0
    assert len(monthly_data["attendance"]) == 1
    assert monthly_data["attendance"][0]["site_name"] == "Airport Terminal"
    assert len(monthly_data["advances"]) == 1
    assert monthly_data["advances"][0]["note"] == "Weekly advance"


def test_wage_value_validation_zero_negative_and_excessive_precision(client: TestClient, auth_headers: dict):
    """
    Verifies that zero wage, negative wage, and excessively precise wage (>2 decimal places)
    are strictly rejected with 422 on both worker creation and wage history addition.
    """
    # 1. Zero wage rejected on worker creation
    resp_zero = client.post(
        "/api/v1/workers",
        json={"name": "Zero Wage Worker", "daily_wage": 0.0, "effective_from": "2026-10-01"},
        headers=auth_headers,
    )
    assert resp_zero.status_code == 422

    # 2. Excessively precise wage rejected on worker creation (e.g. 500.555)
    resp_precise = client.post(
        "/api/v1/workers",
        json={"name": "Precise Worker", "daily_wage": 500.555, "effective_from": "2026-10-01"},
        headers=auth_headers,
    )
    assert resp_precise.status_code == 422

    # 3. Create valid worker
    resp_valid = client.post(
        "/api/v1/workers",
        json={"name": "Valid Wage Worker", "daily_wage": 600.0, "effective_from": "2026-10-01"},
        headers=auth_headers,
    )
    assert resp_valid.status_code == 201
    worker_id = resp_valid.json()["id"]

    # 4. Zero wage rejected on wage history addition
    resp_wage_zero = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 0.0, "effective_from": "2026-10-15"},
        headers=auth_headers,
    )
    assert resp_wage_zero.status_code == 422

    # 5. Negative wage rejected on wage history addition
    resp_wage_neg = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": -50.0, "effective_from": "2026-10-15"},
        headers=auth_headers,
    )
    assert resp_wage_neg.status_code == 422

    # 6. Excessively precise wage rejected on wage history addition
    resp_wage_precise = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 750.123, "effective_from": "2026-10-15"},
        headers=auth_headers,
    )
    assert resp_wage_precise.status_code == 422


def test_payroll_spanning_two_wage_periods_fixture(client: TestClient, auth_headers: dict):
    """
    Test case specified in requirements:
    - 10 work units at ₹700 = ₹7,000.
    - 5 work units at ₹800 = ₹4,000.
    - Total gross earnings = ₹11,000.
    """
    # 1. Create worker with initial wage 700 effective 2026-10-01
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Test Spanning Worker", "daily_wage": 700.0, "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # 2. Create site
    site = client.post(
        "/api/v1/sites",
        json={"name": "Fixture Site", "location": "Sector 62"},
        headers=auth_headers,
    ).json()
    site_id = site["id"]

    # 3. Add 10 work units between Oct 1 and Oct 10 (1.0 unit per day for 10 days)
    for day in range(1, 11):
        date_str = f"2026-10-{day:02d}"
        att_resp = client.post(
            "/api/v1/attendance",
            json={"worker_id": worker_id, "site_id": site_id, "date": date_str, "work_units": 1.0},
            headers=auth_headers,
        )
        assert att_resp.status_code == 201

    # 4. Update wage to 800 effective 2026-10-11
    wage_resp = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 800.0, "effective_from": "2026-10-11"},
        headers=auth_headers,
    )
    assert wage_resp.status_code == 201

    # 5. Add 5 work units between Oct 11 and Oct 15 (1.0 unit per day for 5 days)
    for day in range(11, 16):
        date_str = f"2026-10-{day:02d}"
        att_resp = client.post(
            "/api/v1/attendance",
            json={"worker_id": worker_id, "site_id": site_id, "date": date_str, "work_units": 1.0},
            headers=auth_headers,
        )
        assert att_resp.status_code == 201

    # 6. Verify monthly ledger for October 2026
    monthly_resp = client.get(f"/api/v1/workers/{worker_id}/monthly?year=2026&month=10", headers=auth_headers)
    assert monthly_resp.status_code == 200
    monthly_data = monthly_resp.json()
    assert float(monthly_data["total_work_units"]) == 15.0
    assert float(monthly_data["gross_earnings"]) == 11000.0  # 7,000 + 4,000
    assert float(monthly_data["net_payable"]) == 11000.0

    # Verify itemized earnings:
    # Days 1-10 should have rate 700 and earnings 700
    for item in monthly_data["attendance"]:
        day_num = int(item["date"].split("-")[2])
        if day_num <= 10:
            assert float(item["daily_wage"]) == 700.0
            assert float(item["earnings"]) == 700.0
        else:
            assert float(item["daily_wage"]) == 800.0
            assert float(item["earnings"]) == 800.0

    # 7. Verify overall Payroll endpoint for October 2026
    payroll_resp = client.get("/api/v1/payroll/monthly?year=2026&month=10", headers=auth_headers)
    assert payroll_resp.status_code == 200
    payroll_data = payroll_resp.json()
    worker_entry = next((item for item in payroll_data["rows"] if item["worker_id"] == worker_id), None)
    assert worker_entry is not None
    assert float(worker_entry["total_work_units"]) == 15.0
    assert float(worker_entry["gross_earnings"]) == 11000.0


def test_duplicate_effective_date_updates_in_place(client: TestClient, auth_headers: dict):
    """
    Verifies that posting a wage rate for an already existing effective_from date
    updates the record in-place rather than creating duplicate entries.
    """
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Duplicate Date Worker", "daily_wage": 500.0, "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # Add wage with effective_from 2026-10-15 (rate 600)
    client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 600.0, "effective_from": "2026-10-15"},
        headers=auth_headers,
    )

    # Post another wage with SAME effective_from 2026-10-15 (rate 650)
    resp2 = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 650.0, "effective_from": "2026-10-15"},
        headers=auth_headers,
    )
    assert resp2.status_code == 201
    assert float(resp2.json()["daily_wage"]) == 650.0

    # Verify wage list length has not duplicated
    list_resp = client.get(f"/api/v1/workers/{worker_id}/wages", headers=auth_headers)
    assert list_resp.status_code == 200
    wages = list_resp.json()
    # Should only have 2 records: 2026-10-01 and 2026-10-15
    assert len(wages) == 2
    oct_15_entry = next((w for w in wages if w["effective_from"] == "2026-10-15"), None)
    assert oct_15_entry is not None
    assert float(oct_15_entry["daily_wage"]) == 650.0


def test_future_dated_wage_does_not_prematurely_overwrite_current_wage(client: TestClient, auth_headers: dict):
    """
    Verifies that a future-dated wage rate does not prematurely overwrite worker.daily_wage
    or affect attendance dates prior to that future date.
    """
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Future Wage Worker", "daily_wage": 550.0, "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # Schedule future wage rate for next year
    client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 900.0, "effective_from": "2027-01-01"},
        headers=auth_headers,
    )

    # Check worker.daily_wage remains 550.0
    get_resp = client.get(f"/api/v1/workers/{worker_id}", headers=auth_headers)
    assert get_resp.status_code == 200
    assert float(get_resp.json()["daily_wage"]) == 550.0


def test_unauthorized_cross_account_wage_access_rejected(client: TestClient, auth_headers: dict):
    """
    Verifies that a worker's wage history cannot be accessed or modified with an unauthorized token.
    """
    from app.core.security import create_access_token

    # Create worker under authenticated account
    worker = client.post(
        "/api/v1/workers",
        json={"name": "Account A Worker", "daily_wage": 600.0, "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()
    worker_id = worker["id"]

    # Generate token for an unauthorized foreign account
    foreign_token = create_access_token(subject="00000000-0000-0000-0000-000000000099")
    foreign_headers = {"Authorization": f"Bearer {foreign_token}"}

    # Unauthorized access to read wages rejected with 401
    read_resp = client.get(f"/api/v1/workers/{worker_id}/wages", headers=foreign_headers)
    assert read_resp.status_code == 401

    # Unauthorized access to update wages rejected with 401
    add_resp = client.post(
        f"/api/v1/workers/{worker_id}/wages",
        json={"daily_wage": 999.0, "effective_from": "2026-10-20"},
        headers=foreign_headers,
    )
    assert add_resp.status_code == 401


