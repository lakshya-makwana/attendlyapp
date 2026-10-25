from decimal import Decimal
import pytest
from fastapi.testclient import TestClient


def create_worker(client: TestClient, auth_headers: dict, name: str, daily_wage: float, effective_from: str = "2026-10-01", active: bool = True) -> str:
    resp = client.post(
        "/api/v1/workers",
        json={"name": name, "daily_wage": daily_wage, "effective_from": effective_from, "active": active},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def create_site(client: TestClient, auth_headers: dict, name: str, active: bool = True) -> str:
    resp = client.post(
        "/api/v1/sites",
        json={"name": name, "active": active},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def test_dashboard_summary_requires_authentication(client: TestClient):
    """
    Verifies that the dashboard summary endpoint rejects unauthenticated requests.
    """
    resp_no_token = client.get("/api/v1/dashboard/summary")
    assert resp_no_token.status_code == 401

    resp_bad_token = client.get(
        "/api/v1/dashboard/summary",
        headers={"Authorization": "Bearer invalid.token"},
    )
    assert resp_bad_token.status_code == 401


def test_dashboard_summary_empty_state(client: TestClient, auth_headers: dict):
    """
    Verifies that dashboard summary returns zeroed metrics when the database has no data.
    """
    resp = client.get("/api/v1/dashboard/summary?date=2026-10-15", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()

    assert data["overview"]["active_workers"] == 0
    assert data["overview"]["active_sites"] == 0
    assert data["overview"]["total_workers"] == 0
    assert data["overview"]["total_sites"] == 0

    assert data["today"]["date"] == "2026-10-15"
    assert data["today"]["active_workers"] == 0
    assert data["today"]["present_workers"] == 0
    assert data["today"]["absent_workers"] == 0
    assert data["today"]["total_work_units"] == 0.0
    assert Decimal(str(data["today"]["total_earnings"])) == Decimal("0.00")

    assert data["month"]["year"] == 2026
    assert data["month"]["month"] == 10
    assert data["month"]["start_date"] == "2026-10-01"
    assert data["month"]["end_date"] == "2026-10-31"
    assert data["month"]["total_work_units"] == 0.0
    assert Decimal(str(data["month"]["gross_earnings"])) == Decimal("0.00")
    assert Decimal(str(data["month"]["total_advances"])) == Decimal("0.00")
    assert Decimal(str(data["month"]["net_payable"])) == Decimal("0.00")


def test_dashboard_summary_populated(client: TestClient, auth_headers: dict):
    """
    Verifies dashboard summary calculations with workers, sites, daily attendance,
    and current month rollups.
    """
    # 3 active workers
    w1_id = create_worker(client, auth_headers, "Ramesh", 600.0, effective_from="2026-09-01")
    w2_id = create_worker(client, auth_headers, "Suresh", 800.0, effective_from="2026-09-01")
    w3_id = create_worker(client, auth_headers, "Amit", 500.0, effective_from="2026-09-01")

    # 1 inactive worker
    w4_id = create_worker(client, auth_headers, "Inactive Worker", 400.0, effective_from="2026-09-01", active=False)

    # 2 active sites, 1 inactive site
    site1_id = create_site(client, auth_headers, "Metro Tower Phase 2")
    site2_id = create_site(client, auth_headers, "Sunrise Villa 14")
    site3_id = create_site(client, auth_headers, "Decommissioned Site", active=False)

    # Attendance for 2026-10-15 (Target Date)
    # W1: 1.0 unit @ 600 = 600
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site1_id, "date": "2026-10-15", "work_units": 1.0},
        headers=auth_headers,
    )
    # W2: 0.5 unit @ 800 = 400
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w2_id, "site_id": site2_id, "date": "2026-10-15", "work_units": 0.5},
        headers=auth_headers,
    )
    # W3: 0.0 unit @ 500 = 0 (Absent)
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w3_id, "site_id": site1_id, "date": "2026-10-15", "work_units": 0.0},
        headers=auth_headers,
    )

    # Attendance earlier in the same month (2026-10-10)
    # W1: 1.5 units @ 600 = 900
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site1_id, "date": "2026-10-10", "work_units": 1.5},
        headers=auth_headers,
    )

    # Attendance in a previous month (2026-09-28)
    # W1: 1.0 unit @ 600 = 600
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site1_id, "date": "2026-09-28", "work_units": 1.0},
        headers=auth_headers,
    )

    # Query Dashboard Summary for 2026-10-15
    resp = client.get("/api/v1/dashboard/summary?date=2026-10-15", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()

    # 1. Overview counts
    assert data["overview"]["active_workers"] == 3
    assert data["overview"]["total_workers"] == 4
    assert data["overview"]["active_sites"] == 2
    assert data["overview"]["total_sites"] == 3

    # 2. Today's summary
    today = data["today"]
    assert today["date"] == "2026-10-15"
    assert today["active_workers"] == 3
    assert today["present_workers"] == 2  # W1 (1.0), W2 (0.5)
    assert today["absent_workers"] == 1   # W3 (0.0)
    assert today["marked_workers"] == 3   # 3 workers marked today
    assert today["active_sites"] == 2
    assert today["total_work_units"] == 1.5
    assert Decimal(str(today["total_earnings"])) == Decimal("1000.00")

    # 3. Month summary (October 2026)
    month = data["month"]
    assert month["year"] == 2026
    assert month["month"] == 10
    assert month["start_date"] == "2026-10-01"
    assert month["end_date"] == "2026-10-31"
    # Total units in October: 1.0 (Oct 15) + 0.5 (Oct 15) + 0.0 (Oct 15) + 1.5 (Oct 10) = 3.0
    assert month["total_work_units"] == 3.0
    # Gross in October: 600 + 400 + 0 + 900 = 1900
    assert Decimal(str(month["gross_earnings"])) == Decimal("1900.00")
    assert Decimal(str(month["total_advances"])) == Decimal("0.00")
    assert Decimal(str(month["net_payable"])) == Decimal("1900.00")

    # 4. Sites breakdown in October 2026
    sites = month["sites_breakdown"]
    assert len(sites) == 2  # 2 active sites
    site1 = next(s for s in sites if s["site_id"] == site1_id)
    assert site1["site_name"] == "Metro Tower Phase 2"
    assert site1["unique_worker_count"] == 1
    assert site1["total_work_units"] == 2.5
    assert Decimal(str(site1["total_labour_expense"])) == Decimal("1500.00")

    site2 = next(s for s in sites if s["site_id"] == site2_id)
    assert site2["site_name"] == "Sunrise Villa 14"
    assert site2["unique_worker_count"] == 1
    assert site2["total_work_units"] == 0.5
    assert Decimal(str(site2["total_labour_expense"])) == Decimal("400.00")

    # Query Dashboard for September 2026 (Month filter test)
    resp_sep = client.get("/api/v1/dashboard/summary?year=2026&month=9", headers=auth_headers)
    assert resp_sep.status_code == 200
    sep_data = resp_sep.json()
    sep_month = sep_data["month"]
    assert sep_month["year"] == 2026
    assert sep_month["month"] == 9
    assert sep_month["start_date"] == "2026-09-01"
    assert sep_month["end_date"] == "2026-09-30"
    assert sep_month["total_work_units"] == 1.0
    assert Decimal(str(sep_month["gross_earnings"])) == Decimal("600.00")
    assert Decimal(str(sep_month["net_payable"])) == Decimal("600.00")

