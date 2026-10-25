import datetime
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models import Worker, Advance


def test_advance_endpoints_require_authentication(client: TestClient):
    """
    Verifies that advances endpoints reject requests without a valid token.
    """
    resp = client.get("/api/v1/advances")
    assert resp.status_code == 401

    resp_post = client.post(
        "/api/v1/advances",
        json={"worker_id": "test", "amount": 1000, "date": "2026-10-15"},
    )
    assert resp_post.status_code == 401


def test_record_and_get_advance(client: TestClient, auth_headers: dict, db: Session):
    """
    Verifies recording an advance, reading it back, and verifying worker_name.
    """
    worker = Worker(name="Ramesh Kumar", daily_wage=Decimal("600.00"), active=True)
    db.add(worker)
    db.commit()

    resp = client.post(
        "/api/v1/advances",
        json={
            "worker_id": worker.id,
            "amount": "1500.00",
            "date": "2026-10-15",
            "note": "Diwali Festival Advance",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["worker_id"] == worker.id
    assert data["worker_name"] == "Ramesh Kumar"
    assert Decimal(str(data["amount"])) == Decimal("1500.00")
    assert data["date"] == "2026-10-15"
    assert data["note"] == "Diwali Festival Advance"
    adv_id = data["id"]

    # Read back by ID
    get_resp = client.get(f"/api/v1/advances/{adv_id}", headers=auth_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == adv_id
    assert get_resp.json()["worker_name"] == "Ramesh Kumar"


def test_advance_validation(client: TestClient, auth_headers: dict, db: Session):
    """
    Validates amount > 0, worker existence, and note length constraint.
    """
    worker = Worker(name="Suresh Singh", daily_wage=Decimal("500.00"), active=True)
    db.add(worker)
    db.commit()

    # Amount <= 0 rejected
    resp_zero = client.post(
        "/api/v1/advances",
        json={"worker_id": worker.id, "amount": 0, "date": "2026-10-15"},
        headers=auth_headers,
    )
    assert resp_zero.status_code == 422

    resp_neg = client.post(
        "/api/v1/advances",
        json={"worker_id": worker.id, "amount": -500, "date": "2026-10-15"},
        headers=auth_headers,
    )
    assert resp_neg.status_code == 422

    # Non-existent worker rejected with 404
    resp_fake_worker = client.post(
        "/api/v1/advances",
        json={"worker_id": "nonexistent-worker-uuid", "amount": 1000, "date": "2026-10-15"},
        headers=auth_headers,
    )
    assert resp_fake_worker.status_code == 404
    assert "Worker not found" in resp_fake_worker.json()["detail"]

    # Note too long rejected
    resp_long_note = client.post(
        "/api/v1/advances",
        json={"worker_id": worker.id, "amount": 500, "date": "2026-10-15", "note": "A" * 256},
        headers=auth_headers,
    )
    assert resp_long_note.status_code == 422


def test_list_advances_filtering(client: TestClient, auth_headers: dict, db: Session):
    """
    Verifies filtering advances by worker_id, date range, year, and month.
    """
    w1 = Worker(name="Worker One", daily_wage=Decimal("500.00"), active=True)
    w2 = Worker(name="Worker Two", daily_wage=Decimal("600.00"), active=True)
    db.add_all([w1, w2])
    db.commit()

    adv1 = client.post(
        "/api/v1/advances",
        json={"worker_id": w1.id, "amount": 500, "date": "2026-10-05"},
        headers=auth_headers,
    ).json()

    adv2 = client.post(
        "/api/v1/advances",
        json={"worker_id": w2.id, "amount": 1000, "date": "2026-10-20"},
        headers=auth_headers,
    ).json()

    adv3 = client.post(
        "/api/v1/advances",
        json={"worker_id": w1.id, "amount": 750, "date": "2026-11-02"},
        headers=auth_headers,
    ).json()

    # Filter by worker
    resp_w1 = client.get(f"/api/v1/advances?worker_id={w1.id}", headers=auth_headers)
    assert resp_w1.status_code == 200
    w1_ids = [a["id"] for a in resp_w1.json()]
    assert adv1["id"] in w1_ids
    assert adv3["id"] in w1_ids
    assert adv2["id"] not in w1_ids

    # Filter by month (October)
    resp_oct = client.get("/api/v1/advances?year=2026&month=10", headers=auth_headers)
    assert resp_oct.status_code == 200
    oct_ids = [a["id"] for a in resp_oct.json()]
    assert adv1["id"] in oct_ids
    assert adv2["id"] in oct_ids
    assert adv3["id"] not in oct_ids

    # Filter by month (November)
    resp_nov = client.get("/api/v1/advances?year=2026&month=11", headers=auth_headers)
    assert resp_nov.status_code == 200
    nov_ids = [a["id"] for a in resp_nov.json()]
    assert adv3["id"] in nov_ids
    assert adv1["id"] not in nov_ids


def test_update_and_delete_advance(client: TestClient, auth_headers: dict, db: Session):
    """
    Verifies updating amount/note and deleting an advance record.
    """
    worker = Worker(name="Amit Verma", daily_wage=Decimal("700.00"), active=True)
    db.add(worker)
    db.commit()

    adv = client.post(
        "/api/v1/advances",
        json={"worker_id": worker.id, "amount": 1000, "date": "2026-10-10"},
        headers=auth_headers,
    ).json()
    adv_id = adv["id"]

    # Update amount & note
    put_resp = client.put(
        f"/api/v1/advances/{adv_id}",
        json={"amount": 1200, "note": "Adjusted amount"},
        headers=auth_headers,
    )
    assert put_resp.status_code == 200
    assert Decimal(str(put_resp.json()["amount"])) == Decimal("1200.00")
    assert put_resp.json()["note"] == "Adjusted amount"

    # Delete
    del_resp = client.delete(f"/api/v1/advances/{adv_id}", headers=auth_headers)
    assert del_resp.status_code == 200
    assert "deleted successfully" in del_resp.json()["message"]

    # Confirm 404
    get_resp = client.get(f"/api/v1/advances/{adv_id}", headers=auth_headers)
    assert get_resp.status_code == 404


def test_offline_sync_push_and_pull_for_advances(client: TestClient, auth_headers: dict, db: Session):
    """
    Verifies that offline advance mutations pushed via /sync/push are durably persisted
    and returned in /sync/pull.
    """
    worker = Worker(name="Sync Test Worker", daily_wage=Decimal("550.00"), active=True)
    db.add(worker)
    db.commit()

    client_adv_id = "client_adv_uuid_999"

    # 1. Sync push an advance
    push_resp = client.post(
        "/api/v1/sync/push",
        json={
            "workers": [],
            "sites": [],
            "attendance": [],
            "advances": [
                {
                    "id": client_adv_id,
                    "worker_id": worker.id,
                    "amount": 2500,
                    "date": "2026-10-18",
                    "note": "Offline Created Advance",
                }
            ],
        },
        headers=auth_headers,
    )
    assert push_resp.status_code == 200
    assert push_resp.json()["success"] is True
    assert push_resp.json()["synced_advances"] == 1

    # Verify persisted in database
    adv_in_db = db.query(Advance).filter(Advance.id == client_adv_id).first()
    assert adv_in_db is not None
    assert Decimal(str(adv_in_db.amount)) == Decimal("2500.00")
    assert adv_in_db.note == "Offline Created Advance"

    # 2. Idempotent re-push should update or preserve without duplicate
    push_again = client.post(
        "/api/v1/sync/push",
        json={
            "workers": [],
            "sites": [],
            "attendance": [],
            "advances": [
                {
                    "id": client_adv_id,
                    "worker_id": worker.id,
                    "amount": 2500,
                    "date": "2026-10-18",
                    "note": "Offline Created Advance",
                }
            ],
        },
        headers=auth_headers,
    )
    assert push_again.status_code == 200
    assert push_again.json()["success"] is True
    total_count = db.query(Advance).filter(Advance.id == client_adv_id).count()
    assert total_count == 1

    # 3. Pull returns this advance
    pull_resp = client.get("/api/v1/sync/pull", headers=auth_headers)
    assert pull_resp.status_code == 200
    pulled_advs = pull_resp.json()["advances"]
    matched = [a for a in pulled_advs if a["id"] == client_adv_id]
    assert len(matched) == 1
    assert matched[0]["worker_name"] == "Sync Test Worker"


def test_dashboard_reflects_advances_and_deducts_from_net_payable(
    client: TestClient, auth_headers: dict, db: Session
):
    """
    Verifies that advances are aggregated into the monthly dashboard summary
    and correctly deducted from gross earnings to compute net payable.
    """
    worker = Worker(name="Ledger Worker", daily_wage=Decimal("1000.00"), active=True)
    db.add(worker)
    db.commit()

    site = client.post("/api/v1/sites", json={"name": "Ledger Site"}, headers=auth_headers).json()

    # Record 2 days of attendance in October 2026 (Gross = 2000)
    att1 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker.id, "site_id": site["id"], "date": "2026-10-01", "work_units": 1.0},
        headers=auth_headers,
    )
    assert att1.status_code == 201

    att2 = client.post(
        "/api/v1/attendance",
        json={"worker_id": worker.id, "site_id": site["id"], "date": "2026-10-02", "work_units": 1.0},
        headers=auth_headers,
    )
    assert att2.status_code == 201

    # Record 1 advance in October 2026 (Advance = 500)
    adv_resp = client.post(
        "/api/v1/advances",
        json={"worker_id": worker.id, "amount": 500, "date": "2026-10-05"},
        headers=auth_headers,
    )
    assert adv_resp.status_code == 201

    # Fetch dashboard summary for Oct 2026
    dash_resp = client.get("/api/v1/dashboard/summary?year=2026&month=10", headers=auth_headers)
    assert dash_resp.status_code == 200
    m_summary = dash_resp.json()["month"]
    assert Decimal(str(m_summary["gross_earnings"])) == Decimal("2000.00")
    assert Decimal(str(m_summary["total_advances"])) == Decimal("500.00")
    assert Decimal(str(m_summary["net_payable"])) == Decimal("1500.00")
