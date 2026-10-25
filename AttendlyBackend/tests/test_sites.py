import datetime
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models import Worker, Site, Attendance


def test_site_endpoints_require_authentication(client: TestClient):
    """
    Verifies that site endpoints reject requests without a JWT or with an invalid JWT.
    """
    # Missing token
    resp_no_token = client.get("/api/v1/sites")
    assert resp_no_token.status_code == 401

    # Invalid token
    resp_invalid_token = client.get(
        "/api/v1/sites",
        headers={"Authorization": "Bearer bad.token.here"},
    )
    assert resp_invalid_token.status_code == 401


def test_create_and_read_site(client: TestClient, auth_headers: dict):
    """
    Verifies site creation, validation, and retrieval by ID.
    """
    resp = client.post(
        "/api/v1/sites",
        json={"name": "Palm Residency Block A", "active": True},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Palm Residency Block A"
    assert data["active"] is True
    site_id = data["id"]

    # Read back
    read_resp = client.get(f"/api/v1/sites/{site_id}", headers=auth_headers)
    assert read_resp.status_code == 200
    assert read_resp.json()["id"] == site_id
    assert read_resp.json()["name"] == "Palm Residency Block A"


def test_site_name_validation(client: TestClient, auth_headers: dict):
    """
    Rejects empty or whitespace-only site names.
    """
    resp_empty = client.post(
        "/api/v1/sites",
        json={"name": "   "},
        headers=auth_headers,
    )
    assert resp_empty.status_code == 422


def test_list_sites_filtering(client: TestClient, auth_headers: dict):
    """
    Verifies that inactive sites are excluded by default and included with include_inactive=True.
    """
    # Create active site
    s1 = client.post(
        "/api/v1/sites",
        json={"name": "Active Site Alpha", "active": True},
        headers=auth_headers,
    ).json()

    # Create inactive site
    s2 = client.post(
        "/api/v1/sites",
        json={"name": "Inactive Site Beta", "active": False},
        headers=auth_headers,
    ).json()

    # Default list: active only
    resp_active = client.get("/api/v1/sites", headers=auth_headers)
    assert resp_active.status_code == 200
    active_ids = [s["id"] for s in resp_active.json()]
    assert s1["id"] in active_ids
    assert s2["id"] not in active_ids

    # List with include_inactive=True
    resp_all = client.get("/api/v1/sites?include_inactive=true", headers=auth_headers)
    assert resp_all.status_code == 200
    all_ids = [s["id"] for s in resp_all.json()]
    assert s1["id"] in all_ids
    assert s2["id"] in all_ids


def test_update_and_rename_site(client: TestClient, auth_headers: dict):
    """
    Verifies renaming a site preserves its identity and properties.
    """
    site = client.post(
        "/api/v1/sites",
        json={"name": "Metro Tower 1"},
        headers=auth_headers,
    ).json()
    site_id = site["id"]

    update_resp = client.put(
        f"/api/v1/sites/{site_id}",
        json={"name": "Metro Tower Phase 1 & 2"},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Metro Tower Phase 1 & 2"


def test_deactivate_and_reactivate_site(client: TestClient, auth_headers: dict):
    """
    Verifies deactivating and reactivating a site.
    """
    site = client.post(
        "/api/v1/sites",
        json={"name": "Sunrise Villa"},
        headers=auth_headers,
    ).json()
    site_id = site["id"]

    # Deactivate
    deact_resp = client.post(f"/api/v1/sites/{site_id}/deactivate", headers=auth_headers)
    assert deact_resp.status_code == 200
    assert deact_resp.json()["active"] is False

    # Excluded from active list
    active_list = client.get("/api/v1/sites", headers=auth_headers).json()
    assert site_id not in [s["id"] for s in active_list]

    # Reactivate
    react_resp = client.post(f"/api/v1/sites/{site_id}/reactivate", headers=auth_headers)
    assert react_resp.status_code == 200
    assert react_resp.json()["active"] is True

    # Included in active list again
    active_list_again = client.get("/api/v1/sites", headers=auth_headers).json()
    assert site_id in [s["id"] for s in active_list_again]


def test_nonexistent_site_returns_404(client: TestClient, auth_headers: dict):
    """
    Verifies 404 for nonexistent site queries and updates.
    """
    fake_id = "nonexistent-site-id"
    assert client.get(f"/api/v1/sites/{fake_id}", headers=auth_headers).status_code == 404
    assert client.put(f"/api/v1/sites/{fake_id}", json={"name": "New"}, headers=auth_headers).status_code == 404
    assert client.post(f"/api/v1/sites/{fake_id}/deactivate", headers=auth_headers).status_code == 404
    assert client.post(f"/api/v1/sites/{fake_id}/reactivate", headers=auth_headers).status_code == 404


def test_historical_attendance_preserved_on_site_rename_and_deactivation(
    client: TestClient, auth_headers: dict, db: Session
):
    """
    Verifies that renaming or deactivating a site preserves historical attendance relationships intact.
    """
    # Create site via API
    site_data = client.post(
        "/api/v1/sites",
        json={"name": "Original Site Name"},
        headers=auth_headers,
    ).json()
    site_id = site_data["id"]

    # Create worker & attendance directly in DB
    worker = Worker(name="Attendance Test Worker", daily_wage=Decimal("500.00"), active=True)
    db.add(worker)
    db.commit()

    att = Attendance(
        worker_id=worker.id,
        site_id=site_id,
        date=datetime.date(2026, 10, 10),
        work_units=Decimal("1.0"),
    )
    db.add(att)
    db.commit()

    # 1. Rename site
    client.put(f"/api/v1/sites/{site_id}", json={"name": "Renamed Site"}, headers=auth_headers)

    # Verify attendance still references the site and reflects updated name through relation
    db.refresh(att)
    assert att.site_id == site_id
    assert att.site.name == "Renamed Site"

    # 2. Deactivate site
    client.post(f"/api/v1/sites/{site_id}/deactivate", headers=auth_headers)

    # Verify historical attendance remains completely intact
    db.refresh(att)
    assert att.site_id == site_id
    assert att.site.active is False
    assert att.work_units == Decimal("1.0")


def test_site_location_crud_and_validation(client: TestClient, auth_headers: dict):
    """
    Verifies site creation with location, updating location, and location length validation.
    """
    # Create with location
    resp = client.post(
        "/api/v1/sites",
        json={"name": "Skyline Heights", "location": "Sector 62, Noida"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Skyline Heights"
    assert data["location"] == "Sector 62, Noida"
    site_id = data["id"]

    # Update location
    resp_update = client.put(
        f"/api/v1/sites/{site_id}",
        json={"location": "Plot 14, Sector 62, Noida"},
        headers=auth_headers,
    )
    assert resp_update.status_code == 200
    assert resp_update.json()["location"] == "Plot 14, Sector 62, Noida"

    # Also support address alias for PWA schema compatibility
    resp_address = client.post(
        "/api/v1/sites",
        json={"name": "Grand Arch", "address": "Golf Course Road, Gurgaon"},
        headers=auth_headers,
    )
    assert resp_address.status_code == 201
    assert resp_address.json()["location"] == "Golf Course Road, Gurgaon"

    # Reject location exceeding 255 chars
    resp_toolong = client.post(
        "/api/v1/sites",
        json={"name": "Too Long Site", "location": "A" * 256},
        headers=auth_headers,
    )
    assert resp_toolong.status_code == 422


def test_toggle_site_status(client: TestClient, auth_headers: dict):
    """
    Verifies PATCH /sites/{id}/toggle-status flips active to inactive and back.
    """
    resp = client.post(
        "/api/v1/sites",
        json={"name": "Toggle Test Site", "active": True},
        headers=auth_headers,
    )
    site_id = resp.json()["id"]
    assert resp.json()["active"] is True

    # 1st toggle -> False
    resp_toggle1 = client.patch(f"/api/v1/sites/{site_id}/toggle-status", headers=auth_headers)
    assert resp_toggle1.status_code == 200
    assert resp_toggle1.json()["active"] is False

    # 2nd toggle -> True
    resp_toggle2 = client.patch(f"/api/v1/sites/{site_id}/toggle-status", headers=auth_headers)
    assert resp_toggle2.status_code == 200
    assert resp_toggle2.json()["active"] is True


def test_delete_site_without_attendance(client: TestClient, auth_headers: dict):
    """
    Verifies that a site with NO attendance records can be safely deleted.
    """
    resp = client.post(
        "/api/v1/sites",
        json={"name": "Unused Site"},
        headers=auth_headers,
    )
    site_id = resp.json()["id"]

    # Delete site
    del_resp = client.delete(f"/api/v1/sites/{site_id}", headers=auth_headers)
    assert del_resp.status_code == 200
    assert "deleted successfully" in del_resp.json()["message"]

    # Read back should 404
    get_resp = client.get(f"/api/v1/sites/{site_id}", headers=auth_headers)
    assert get_resp.status_code == 404


def test_delete_site_blocked_with_historical_attendance(
    client: TestClient, auth_headers: dict, db: Session
):
    """
    Verifies that deleting a site with existing attendance records is blocked with HTTP 400
    and matches PWA message requiring deactivation instead.
    """
    resp = client.post(
        "/api/v1/sites",
        json={"name": "Historical Project Site"},
        headers=auth_headers,
    )
    site_id = resp.json()["id"]

    # Record attendance against this site
    worker = Worker(name="Site Delete Guard Worker", daily_wage=Decimal("600.00"), active=True)
    db.add(worker)
    db.commit()

    att = Attendance(
        worker_id=worker.id,
        site_id=site_id,
        date=datetime.date(2026, 10, 11),
        work_units=Decimal("1.0"),
    )
    db.add(att)
    db.commit()

    # Attempt delete
    del_resp = client.delete(f"/api/v1/sites/{site_id}", headers=auth_headers)
    assert del_resp.status_code == 400
    detail = del_resp.json()["detail"]
    assert "Cannot delete 'Historical Project Site'" in detail
    assert "historical attendance records" in detail
    assert "Please deactivate the site instead" in detail

    # Verify site still exists and active
    get_resp = client.get(f"/api/v1/sites/{site_id}", headers=auth_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Historical Project Site"
