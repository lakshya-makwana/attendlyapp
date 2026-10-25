import pytest
from datetime import date
from decimal import Decimal
from fastapi.testclient import TestClient


def test_site_analytics_requires_authentication(client: TestClient):
    resp = client.get("/api/v1/sites/analytics")
    assert resp.status_code == 401


def test_site_analytics_empty_state(client: TestClient, auth_headers: dict):
    resp = client.get("/api/v1/sites/analytics?year=2026&month=10", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["year"] == 2026
    assert data["month"] == 10
    assert data["month_name"] == "October 2026"
    assert data["total_sites_used"] == 0
    assert data["total_unique_workers"] == 0
    assert float(data["total_work_units"]) == 0.0
    assert float(data["total_labour_expense"]) == 0.0
    assert isinstance(data["sites"], list)


def test_site_analytics_calculations_and_historical_attribution(client: TestClient, auth_headers: dict):
    # Create 2 sites: Site A and Site B
    site_a = client.post(
        "/api/v1/sites",
        json={"name": "Metro Station", "location": "Sector 14"},
        headers=auth_headers,
    ).json()

    site_b = client.post(
        "/api/v1/sites",
        json={"name": "Highway Flyover", "location": "Ring Road"},
        headers=auth_headers,
    ).json()

    # Create 2 workers:
    # Worker 1: daily wage 600, revised to 700 on 2026-10-10
    w1 = client.post(
        "/api/v1/workers",
        json={"name": "Anil Sharma", "daily_wage": 600.0, "phone": "+919876540001", "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()

    client.post(
        f"/api/v1/workers/{w1['id']}/wages",
        json={"effective_from": "2026-10-10", "daily_wage": 700.0},
        headers=auth_headers,
    )

    # Worker 2: daily wage 500
    w2 = client.post(
        "/api/v1/workers",
        json={"name": "Sunil Verma", "daily_wage": 500.0, "phone": "+919876540002", "effective_from": "2026-10-01"},
        headers=auth_headers,
    ).json()

    # Record attendance:
    # 2026-10-02: Anil at Site A (1.0 unit @ 600) -> 600
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1["id"], "site_id": site_a["id"], "date": "2026-10-02", "work_units": 1.0},
        headers=auth_headers,
    )

    # 2026-10-15: Anil at Site A (1.5 units @ 700) -> 1050
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w1["id"], "site_id": site_a["id"], "date": "2026-10-15", "work_units": 1.5},
        headers=auth_headers,
    )

    # 2026-10-02: Sunil at Site B (0.5 unit @ 500) -> 250
    client.post(
        "/api/v1/attendance",
        json={"worker_id": w2["id"], "site_id": site_b["id"], "date": "2026-10-02", "work_units": 0.5},
        headers=auth_headers,
    )

    # Fetch site analytics for October 2026
    resp = client.get("/api/v1/sites/analytics?year=2026&month=10", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()

    assert data["total_sites_used"] == 2
    assert data["total_unique_workers"] == 2
    # Total units: 1.0 + 1.5 + 0.5 = 3.0
    assert float(data["total_work_units"]) == 3.0
    # Total expense: 600 + 1050 + 250 = 1900.00
    assert float(data["total_labour_expense"]) == 1900.00

    # Check Site A
    site_a_data = next((s for s in data["sites"] if s["site_id"] == site_a["id"]), None)
    assert site_a_data is not None
    assert site_a_data["site_name"] == "Metro Station"
    assert site_a_data["location"] == "Sector 14"
    assert site_a_data["unique_worker_count"] == 1
    assert float(site_a_data["total_work_units"]) == 2.5
    assert float(site_a_data["total_labour_expense"]) == 1650.00
    assert len(site_a_data["workers"]) == 1
    assert site_a_data["workers"][0]["worker_name"] == "Anil Sharma"
    # 2 distinct wage rates applied: 600 and 700
    assert len(site_a_data["workers"][0]["wage_breakdown"]) == 2

    # Check Site B
    site_b_data = next((s for s in data["sites"] if s["site_id"] == site_b["id"]), None)
    assert site_b_data is not None
    assert site_b_data["site_name"] == "Highway Flyover"
    assert site_b_data["unique_worker_count"] == 1
    assert float(site_b_data["total_work_units"]) == 0.5
    assert float(site_b_data["total_labour_expense"]) == 250.00

    # Deactivate Site B and verify historical data remains intact
    client.patch(f"/api/v1/sites/{site_b['id']}/toggle-status", headers=auth_headers)

    resp_after = client.get("/api/v1/sites/analytics?year=2026&month=10", headers=auth_headers)
    assert resp_after.status_code == 200
    data_after = resp_after.json()

    site_b_after = next((s for s in data_after["sites"] if s["site_id"] == site_b["id"]), None)
    assert site_b_after is not None
    assert site_b_after["is_active"] is False
    assert float(site_b_after["total_labour_expense"]) == 250.00
    assert float(data_after["total_labour_expense"]) == 1900.00
