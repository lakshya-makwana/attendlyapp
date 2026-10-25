import pytest
from datetime import date
from decimal import Decimal
from fastapi.testclient import TestClient


def setup_payroll_scenario(client: TestClient, phone: str = "+919988774401"):
    resp = client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "mpin": "1234", "confirm_mpin": "1234"},
    )
    assert resp.status_code in (200, 201), resp.text
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Worker 1: 500/day
    w1 = client.post(
        "/api/v1/workers",
        json={"name": "Ramesh Kumar", "daily_wage": 500.0, "effective_from": "2026-09-01"},
        headers=headers,
    ).json()

    # Worker 2: 700/day
    w2 = client.post(
        "/api/v1/workers",
        json={"name": "Suresh Patel", "daily_wage": 700.0, "effective_from": "2026-09-01"},
        headers=headers,
    ).json()

    site = client.post(
        "/api/v1/sites",
        json={"name": "Project Alpha", "location": "Sector 4"},
        headers=headers,
    ).json()

    return headers, w1["id"], w2["id"], site["id"]


def test_monthly_payroll_calculation(client: TestClient):
    headers, w1_id, w2_id, site_id = setup_payroll_scenario(client, "+919988774402")

    # W1: 3 days of 1.0 = 3 * 500 = 1500
    for day in range(1, 4):
        resp = client.post(
            "/api/v1/attendance",
            json={
                "worker_id": w1_id,
                "site_id": site_id,
                "date": f"2026-10-0{day}",
                "work_units": 1.0,
            },
            headers=headers,
        )
        assert resp.status_code == 201

    # W2: 2 days of 1.5 = 2 * (1.5 * 700) = 2100
    for day in range(1, 3):
        resp = client.post(
            "/api/v1/attendance",
            json={
                "worker_id": w2_id,
                "site_id": site_id,
                "date": f"2026-10-0{day}",
                "work_units": 1.5,
            },
            headers=headers,
        )
        assert resp.status_code == 201

    # Advance for W1: 400
    client.post(
        "/api/v1/advances",
        json={
            "worker_id": w1_id,
            "amount": 400.0,
            "date": "2026-10-02",
            "note": "Advance for travel",
        },
        headers=headers,
    )

    # Advance for W2: 500
    client.post(
        "/api/v1/advances",
        json={
            "worker_id": w2_id,
            "amount": 500.0,
            "date": "2026-10-02",
        },
        headers=headers,
    )

    # Query Monthly Payroll for October 2026
    resp = client.get("/api/v1/payroll/monthly?year=2026&month=10", headers=headers)
    assert resp.status_code == 200
    payroll = resp.json()

    assert payroll["year"] == 2026
    assert payroll["month"] == 10
    assert payroll["month_name"] == "October 2026"
    assert payroll["start_date"] == "2026-10-01"
    assert payroll["end_date"] == "2026-10-31"

    # Total Gross: 1500 + 2100 = 3600
    assert float(payroll["total_gross_wages"]) == 3600.0
    assert float(payroll["total_gross"]) == 3600.0
    # Total Advances: 400 + 500 = 900
    assert float(payroll["total_advances"]) == 900.0
    # Total Net: 3600 - 900 = 2700
    assert float(payroll["total_net_payable"]) == 2700.0
    # Total work units: 3.0 + 3.0 = 6.0
    assert float(payroll["total_work_units"]) == 6.0
    assert payroll["worker_count"] == 2

    # Verify per-worker breakdown
    workers_map = {item["worker_id"]: item for item in payroll["rows"]}
    assert float(workers_map[w1_id]["gross_earnings"]) == 1500.0
    assert float(workers_map[w1_id]["total_advances"]) == 400.0
    assert float(workers_map[w1_id]["net_payable"]) == 1100.0
    assert float(workers_map[w1_id]["total_work_units"]) == 3.0

    assert float(workers_map[w2_id]["gross_earnings"]) == 2100.0
    assert float(workers_map[w2_id]["total_advances"]) == 500.0
    assert float(workers_map[w2_id]["net_payable"]) == 1600.0
    assert float(workers_map[w2_id]["total_work_units"]) == 3.0


def test_payroll_calendar_month_boundaries_and_year_changes(client: TestClient):
    headers, w1_id, _, site_id = setup_payroll_scenario(client, "+919988774403")

    # Attendance in September (boundary before)
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-09-30", "work_units": 1.0},
        headers=headers,
    )
    # Attendance in October (first and last day)
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-01", "work_units": 1.0},
        headers=headers,
    )
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-31", "work_units": 1.0},
        headers=headers,
    )
    # Attendance in November (boundary after)
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-11-01", "work_units": 1.0},
        headers=headers,
    )

    # Attendance across year boundary: Dec 31 2026 and Jan 1 2027
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-12-31", "work_units": 1.0},
        headers=headers,
    )
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2027-01-01", "work_units": 1.0},
        headers=headers,
    )

    # October payroll must have exactly 2 units (Oct 1 and Oct 31)
    resp_oct = client.get("/api/v1/payroll/monthly?year=2026&month=10", headers=headers)
    assert resp_oct.status_code == 200
    oct_data = resp_oct.json()
    assert float(oct_data["total_work_units"]) == 2.0
    assert float(oct_data["total_gross_wages"]) == 1000.0

    # September payroll must have 1 unit (Sep 30)
    resp_sep = client.get("/api/v1/payroll/monthly?year=2026&month=9", headers=headers)
    assert resp_sep.status_code == 200
    assert float(resp_sep.json()["total_work_units"]) == 1.0

    # December 2026 payroll has 1 unit
    resp_dec = client.get("/api/v1/payroll/monthly?year=2026&month=12", headers=headers)
    assert resp_dec.status_code == 200
    assert float(resp_dec.json()["total_work_units"]) == 1.0

    # January 2027 payroll has 1 unit
    resp_jan = client.get("/api/v1/payroll/monthly?year=2027&month=1", headers=headers)
    assert resp_jan.status_code == 200
    assert float(resp_jan.json()["total_work_units"]) == 1.0


def test_payroll_wage_history_revision_during_month(client: TestClient):
    headers, w1_id, _, site_id = setup_payroll_scenario(client, "+919988774404")

    # W1 initial wage is 500
    # Add wage revision on Oct 15 to 650
    rev_resp = client.post(
        f"/api/v1/workers/{w1_id}/wage-history",
        json={"daily_wage": 650.0, "effective_from": "2026-10-15"},
        headers=headers,
    )
    assert rev_resp.status_code == 201

    # 2 days worked before revision (Oct 10, Oct 11) -> 2 * 500 = 1000
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-10", "work_units": 1.0},
        headers=headers,
    )
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-11", "work_units": 1.0},
        headers=headers,
    )

    # 2 days worked after revision (Oct 15, Oct 16) -> 2 * 650 = 1300
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-15", "work_units": 1.0},
        headers=headers,
    )
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-16", "work_units": 1.0},
        headers=headers,
    )

    resp = client.get("/api/v1/payroll/monthly?year=2026&month=10", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    w1_row = next(r for r in data["rows"] if r["worker_id"] == w1_id)

    # Total units = 4.0, Gross = 1000 + 1300 = 2300
    assert float(w1_row["total_work_units"]) == 4.0
    assert float(w1_row["gross_earnings"]) == 2300.0

    # Wage breakdown should show 2 rates: 500 and 650
    rates_map = {float(item["rate"]): item for item in w1_row["wage_breakdown"]}
    assert 500.0 in rates_map
    assert 650.0 in rates_map
    assert float(rates_map[500.0]["work_units"]) == 2.0
    assert float(rates_map[500.0]["earnings"]) == 1000.0
    assert float(rates_map[650.0]["work_units"]) == 2.0
    assert float(rates_map[650.0]["earnings"]) == 1300.0


def test_payroll_work_units_variations(client: TestClient):
    headers, w1_id, _, site_id = setup_payroll_scenario(client, "+919988774405")
    # Rate is 500
    # Day 1: 0 units (absent) -> 0
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-01", "work_units": 0.0},
        headers=headers,
    )
    # Day 2: 0.5 units (half-day) -> 250
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-02", "work_units": 0.5},
        headers=headers,
    )
    # Day 3: 1.0 units (full day) -> 500
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-03", "work_units": 1.0},
        headers=headers,
    )
    # Day 4: 1.5 units (overtime) -> 750
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-04", "work_units": 1.5},
        headers=headers,
    )
    # Day 5: 2.0 units (double shift) -> 1000
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-05", "work_units": 2.0},
        headers=headers,
    )

    resp = client.get("/api/v1/payroll/monthly?year=2026&month=10", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    w1_row = next(r for r in data["rows"] if r["worker_id"] == w1_id)

    # 0 + 0.5 + 1.0 + 1.5 + 2.0 = 5.0 units
    assert float(w1_row["total_work_units"]) == 5.0
    # 0 + 250 + 500 + 750 + 1000 = 2500 gross
    assert float(w1_row["gross_earnings"]) == 2500.0


def test_payroll_advances_exceeding_gross(client: TestClient):
    headers, w1_id, _, site_id = setup_payroll_scenario(client, "+919988774406")

    # W1 worked 1 day: 500 gross
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-01", "work_units": 1.0},
        headers=headers,
    )
    # Advance given: 1200
    client.post(
        "/api/v1/advances",
        json={"worker_id": w1_id, "amount": 1200.0, "date": "2026-10-02"},
        headers=headers,
    )

    resp = client.get("/api/v1/payroll/monthly?year=2026&month=10", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    w1_row = next(r for r in data["rows"] if r["worker_id"] == w1_id)

    assert float(w1_row["gross_earnings"]) == 500.0
    assert float(w1_row["total_advances"]) == 1200.0
    # Net payable should be negative (-700), matching PWA behaviour (not clamped to 0)
    assert float(w1_row["net_payable"]) == -700.0
    assert float(data["total_net_payable"]) == -700.0


def test_payroll_inactive_workers_handling(client: TestClient):
    headers, w1_id, w2_id, site_id = setup_payroll_scenario(client, "+919988774407")

    # W1 worked in October
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-01", "work_units": 1.0},
        headers=headers,
    )
    # Deactivate W1
    client.put(f"/api/v1/workers/{w1_id}", json={"active": False}, headers=headers)

    # Deactivate W2 (no attendance, no advances)
    client.put(f"/api/v1/workers/{w2_id}", json={"active": False}, headers=headers)

    resp_oct = client.get("/api/v1/payroll/monthly?year=2026&month=10", headers=headers)
    assert resp_oct.status_code == 200
    oct_rows = resp_oct.json()["rows"]
    oct_worker_ids = [r["worker_id"] for r in oct_rows]

    # W1 has attendance in Oct, so W1 IS included
    assert w1_id in oct_worker_ids
    # W2 has no attendance and no advances, and is inactive, so W2 is EXCLUDED
    assert w2_id not in oct_worker_ids

    # In November, W1 has NO attendance and is inactive -> W1 should be EXCLUDED
    resp_nov = client.get("/api/v1/payroll/monthly?year=2026&month=11", headers=headers)
    assert resp_nov.status_code == 200
    nov_worker_ids = [r["worker_id"] for r in resp_nov.json()["rows"]]
    assert w1_id not in nov_worker_ids
    assert w2_id not in nov_worker_ids


def test_payroll_empty_month(client: TestClient):
    headers, w1_id, w2_id, _ = setup_payroll_scenario(client, "+919988774408")

    resp = client.get("/api/v1/payroll/monthly?year=2026&month=8", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert float(data["total_gross_wages"]) == 0.0
    assert float(data["total_advances"]) == 0.0
    assert float(data["total_net_payable"]) == 0.0
    assert float(data["total_work_units"]) == 0.0
    assert data["worker_count"] == 2  # active workers shown with 0 earnings


def test_worker_monthly_detail_endpoint(client: TestClient):
    headers, w1_id, _, site_id = setup_payroll_scenario(client, "+919988774409")

    # Site 2
    site2 = client.post(
        "/api/v1/sites",
        json={"name": "Project Beta", "location": "Sector 9"},
        headers=headers,
    ).json()

    # W1 works 2 days at Site 1 (1.0 each) and 1 day at Site 2 (1.5)
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-01", "work_units": 1.0},
        headers=headers,
    )
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": "2026-10-02", "work_units": 1.0},
        headers=headers,
    )
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site2["id"], "date": "2026-10-03", "work_units": 1.5},
        headers=headers,
    )

    # Advance
    client.post(
        "/api/v1/advances",
        json={"worker_id": w1_id, "amount": 300.0, "date": "2026-10-02"},
        headers=headers,
    )

    resp = client.get(f"/api/v1/workers/{w1_id}/monthly?year=2026&month=10", headers=headers)
    assert resp.status_code == 200
    detail = resp.json()

    assert detail["worker_id"] == w1_id
    assert detail["worker_name"] == "Ramesh Kumar"
    assert detail["year"] == 2026
    assert detail["month"] == 10
    # Total units: 2.0 + 1.5 = 3.5
    assert float(detail["total_work_units"]) == 3.5
    # Gross: 3.5 * 500 = 1750
    assert float(detail["gross_earnings"]) == 1750.0
    assert float(detail["total_advances"]) == 300.0
    assert float(detail["net_payable"]) == 1450.0

    # Sites worked breakdown
    sites = {s["site_name"]: s for s in detail["sites_worked"]}
    assert "Project Alpha" in sites
    assert float(sites["Project Alpha"]["work_units"]) == 2.0
    assert float(sites["Project Alpha"]["earnings"]) == 1000.0

    assert "Project Beta" in sites
    assert float(sites["Project Beta"]["work_units"]) == 1.5
    assert float(sites["Project Beta"]["earnings"]) == 750.0


def test_payroll_authentication_required(client: TestClient):
    resp = client.get("/api/v1/payroll/monthly?year=2026&month=10")
    assert resp.status_code == 401


def test_payroll_dashboard_reconciliation(client: TestClient):
    headers, w1_id, _, site_id = setup_payroll_scenario(client, "+919988774410")

    today = date.today()
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1_id, "site_id": site_id, "date": today.isoformat(), "work_units": 1.0},
        headers=headers,
    )
    client.post(
        "/api/v1/advances",
        json={"worker_id": w1_id, "amount": 250.0, "date": today.isoformat()},
        headers=headers,
    )

    payroll_resp = client.get(
        f"/api/v1/payroll/monthly?year={today.year}&month={today.month}",
        headers=headers,
    )
    assert payroll_resp.status_code == 200
    payroll_data = payroll_resp.json()

    dash_resp = client.get("/api/v1/dashboard/summary", headers=headers)
    assert dash_resp.status_code == 200
    dash_data = dash_resp.json()

    assert float(payroll_data["total_gross_wages"]) == float(dash_data["month"]["gross_earnings"])
    assert float(payroll_data["total_advances"]) == float(dash_data["month"]["total_advances"])
    assert float(payroll_data["total_net_payable"]) == float(dash_data["month"]["net_payable"])
