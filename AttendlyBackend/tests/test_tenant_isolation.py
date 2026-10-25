import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.account import Account
from app.core.security import hash_mpin, create_access_token


def create_synthetic_account(db: Session, phone: str, mpin: str = "1234"):
    acc = Account(phone_number=phone, mpin_hash=hash_mpin(mpin))
    db.add(acc)
    db.commit()
    db.refresh(acc)
    token = create_access_token(subject=acc.id)
    headers = {"Authorization": f"Bearer {token}"}
    return acc.id, headers


def test_tenant_isolation(client: TestClient, db: Session):
    # Create contractor Account A
    acc_a_id, headers_a = create_synthetic_account(db, "+911000000001")
    # Create contractor Account B
    acc_b_id, headers_b = create_synthetic_account(db, "+911000000002")

    # 1. Account A creates worker and site
    worker_a = client.post(
        "/api/v1/workers",
        json={"name": "Worker A", "daily_wage": 500.0, "effective_from": "2026-10-01"},
        headers=headers_a,
    ).json()

    site_a = client.post(
        "/api/v1/sites",
        json={"name": "Site A", "location": "Downtown"},
        headers=headers_a,
    ).json()

    # 2. Account B creates worker and site
    worker_b = client.post(
        "/api/v1/workers",
        json={"name": "Worker B", "daily_wage": 600.0, "effective_from": "2026-10-01"},
        headers=headers_b,
    ).json()

    site_b = client.post(
        "/api/v1/sites",
        json={"name": "Site B", "location": "Uptown"},
        headers=headers_b,
    ).json()

    # 3. Verify Account A cannot see Account B's worker or site
    workers_a_list = client.get("/api/v1/workers", headers=headers_a).json()
    worker_ids_a = [w["id"] for w in workers_a_list]
    assert worker_a["id"] in worker_ids_a
    assert worker_b["id"] not in worker_ids_a

    sites_a_list = client.get("/api/v1/sites", headers=headers_a).json()
    site_ids_a = [s["id"] for s in sites_a_list]
    assert site_a["id"] in site_ids_a
    assert site_b["id"] not in site_ids_a

    # 4. Direct GET cross-account check
    resp = client.get(f"/api/v1/workers/{worker_b['id']}", headers=headers_a)
    assert resp.status_code == 404

    resp = client.get(f"/api/v1/sites/{site_b['id']}", headers=headers_a)
    assert resp.status_code == 404

    # 5. Direct PUT / DELETE cross-account check
    resp = client.put(
        f"/api/v1/workers/{worker_b['id']}",
        json={"name": "Hacked Name"},
        headers=headers_a,
    )
    assert resp.status_code == 404

    resp = client.delete(f"/api/v1/workers/{worker_b['id']}", headers=headers_a)
    assert resp.status_code == 404

    # 6. Account A cannot record attendance for Account B's worker or site
    resp = client.post(
        "/api/v1/attendance",
        json={
            "worker_id": worker_b["id"],
            "site_id": site_a["id"],
            "date": "2026-10-01",
            "work_units": 1.0,
        },
        headers=headers_a,
    )
    assert resp.status_code == 404

    resp = client.post(
        "/api/v1/attendance",
        json={
            "worker_id": worker_a["id"],
            "site_id": site_b["id"],
            "date": "2026-10-01",
            "work_units": 1.0,
        },
        headers=headers_a,
    )
    assert resp.status_code == 404

    # 7. Account A records valid attendance and advance
    att_a = client.post(
        "/api/v1/attendance",
        json={
            "worker_id": worker_a["id"],
            "site_id": site_a["id"],
            "date": "2026-10-01",
            "work_units": 1.5,
        },
        headers=headers_a,
    ).json()

    adv_a = client.post(
        "/api/v1/advances",
        json={
            "worker_id": worker_a["id"],
            "amount": 200.0,
            "date": "2026-10-01",
            "note": "Lunch",
        },
        headers=headers_a,
    ).json()

    # 8. Account B cannot see Account A's attendance or advances
    att_b_list = client.get("/api/v1/attendance", headers=headers_b).json()
    assert len(att_b_list) == 0

    adv_b_list = client.get("/api/v1/advances", headers=headers_b).json()
    assert len(adv_b_list) == 0

    # 9. Account B payroll is isolated from Account A
    payroll_b = client.get(
        "/api/v1/payroll/monthly?year=2026&month=10",
        headers=headers_b,
    ).json()
    assert float(payroll_b["total_gross"]) == 0.0
    assert float(payroll_b["total_advances"]) == 0.0
    assert float(payroll_b["total_net_payable"]) == 0.0

    payroll_a = client.get(
        "/api/v1/payroll/monthly?year=2026&month=10",
        headers=headers_a,
    ).json()
    # 1.5 work units * 500 wage = 750 gross; 200 advance -> 550 net
    assert float(payroll_a["total_gross"]) == 750.0
    assert float(payroll_a["total_advances"]) == 200.0
    assert float(payroll_a["total_net_payable"]) == 550.0

    # 10. Sync pull isolation
    sync_b = client.get("/api/v1/sync/pull", headers=headers_b).json()
    sync_b_worker_ids = [w["id"] for w in sync_b["workers"]]
    sync_b_site_ids = [s["id"] for s in sync_b["sites"]]
    sync_b_att_ids = [a["id"] for a in sync_b["attendance"]]
    sync_b_adv_ids = [ad["id"] for ad in sync_b["advances"]]

    assert worker_a["id"] not in sync_b_worker_ids
    assert site_a["id"] not in sync_b_site_ids
    assert att_a["id"] not in sync_b_att_ids
    assert adv_a["id"] not in sync_b_adv_ids
    assert worker_b["id"] in sync_b_worker_ids
    assert site_b["id"] in sync_b_site_ids

    # 11. Sync push cross-account modification protection
    push_resp = client.post(
        "/api/v1/sync/push",
        json={
            "workers": [
                {
                    "id": worker_a["id"],
                    "name": "Hijacked Worker Name",
                    "daily_wage": 999.0,
                    "active": True,
                }
            ],
            "sites": [],
            "attendance": [],
            "advances": [],
        },
        headers=headers_b,
    ).json()
    assert push_resp["success"] is False
    assert any("Cross-account" in err for err in push_resp["errors"])

    # Verify Account A's worker was NOT modified
    worker_a_check = client.get(f"/api/v1/workers/{worker_a['id']}", headers=headers_a).json()
    assert worker_a_check["name"] == "Worker A"
