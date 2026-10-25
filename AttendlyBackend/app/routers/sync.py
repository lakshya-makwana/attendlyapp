from datetime import datetime, timezone, date
from decimal import Decimal
from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.account import Account
from app.models.worker import Worker
from app.models.worker_wage_history import WorkerWageHistory
from app.models.site import Site
from app.models.attendance import Attendance
from app.models.advance import Advance
from app.core.dependencies import get_current_account
from app.routers.attendance import build_attendance_response
from app.routers.advances import build_advance_response
from app.schemas.sync import SyncPushRequest, SyncPushResponse, SyncPullResponse
from app.schemas.worker import WorkerResponse
from app.schemas.site import SiteResponse
from app.schemas.attendance import AttendanceResponse
from app.schemas.advance import AdvanceResponse
from app.models.common import generate_uuid

router = APIRouter(prefix="/sync", tags=["Synchronization"])


@router.post("/push", response_model=SyncPushResponse)
def sync_push(
    payload: SyncPushRequest,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Offline Synchronization Push:
    Derives account ownership strictly from the authenticated JWT session.
    Upserts Sites, Workers, and Attendance records idempotently.
    Repeated sync requests will update or preserve existing records without duplicates.
    """
    synced_workers = 0
    synced_sites = 0
    synced_attendance = 0
    synced_advances = 0
    errors: List[str] = []

    # 1. Process Sites
    for s in payload.sites:
        try:
            site_id = s.id if s.id else generate_uuid()
            existing_site = db.query(Site).filter(Site.id == site_id).first()
            location_val = s.resolved_location() if hasattr(s, "resolved_location") else getattr(s, "location", None)
            if existing_site:
                if existing_site.account_id and existing_site.account_id != current_account.id:
                    errors.append(f"Site error ({getattr(s, 'name', 'unknown')}): Cross-account modification forbidden")
                    continue
                existing_site.name = s.name
                existing_site.location = location_val
                existing_site.active = s.active
                existing_site.account_id = current_account.id
            else:
                site = Site(
                    id=site_id,
                    account_id=current_account.id,
                    name=s.name,
                    location=location_val,
                    active=s.active,
                )
                db.add(site)
            synced_sites += 1
        except Exception as e:
            errors.append(f"Site error ({getattr(s, 'name', 'unknown')}): {str(e)}")

    # 2. Process Workers
    for w in payload.workers:
        try:
            worker_id = w.id if w.id else generate_uuid()
            existing_worker = db.query(Worker).filter(Worker.id == worker_id).first()
            phone_val = getattr(w, "phone", None)
            if phone_val:
                phone_val = phone_val.strip()

            if existing_worker:
                if existing_worker.account_id and existing_worker.account_id != current_account.id:
                    errors.append(f"Worker error ({getattr(w, 'name', 'unknown')}): Cross-account modification forbidden")
                    continue
                existing_worker.name = w.name
                if phone_val is not None:
                    existing_worker.phone = phone_val
                existing_worker.daily_wage = w.daily_wage
                existing_worker.active = w.active
                existing_worker.account_id = current_account.id
            else:
                worker = Worker(
                    id=worker_id,
                    account_id=current_account.id,
                    name=w.name,
                    phone=phone_val,
                    daily_wage=w.daily_wage,
                    active=w.active,
                )
                db.add(worker)
                # Create initial wage history entry
                wage_entry = WorkerWageHistory(
                    account_id=current_account.id,
                    worker_id=worker_id,
                    daily_wage=w.daily_wage,
                    effective_from=w.effective_from or date.today(),
                )
                db.add(wage_entry)
            synced_workers += 1
        except Exception as e:
            errors.append(f"Worker error ({getattr(w, 'name', 'unknown')}): {str(e)}")

    db.flush()

    # 3. Process Attendance
    for a in payload.attendance:
        try:
            worker_exists = db.query(Worker).filter(
                Worker.id == a.worker_id,
                (Worker.account_id == current_account.id) | (Worker.account_id.is_(None)),
            ).first()
            if not worker_exists:
                errors.append(f"Attendance error: Worker {a.worker_id} not found")
                continue

            units = Decimal(str(a.work_units))
            site_id_to_save = None

            if units > Decimal("0"):
                if not a.site_id:
                    errors.append("Attendance error: Site required when work units > 0")
                    continue
                site_exists = db.query(Site).filter(
                    Site.id == a.site_id,
                    (Site.account_id == current_account.id) | (Site.account_id.is_(None)),
                ).first()
                if not site_exists:
                    errors.append(f"Attendance error: Site {a.site_id} not found")
                    continue
                site_id_to_save = a.site_id
            else:
                if a.site_id:
                    site_exists = db.query(Site).filter(
                        Site.id == a.site_id,
                        (Site.account_id == current_account.id) | (Site.account_id.is_(None)),
                    ).first()
                    if site_exists:
                        site_id_to_save = a.site_id

            existing_att = (
                db.query(Attendance)
                .filter(
                    Attendance.worker_id == a.worker_id,
                    Attendance.date == a.date,
                    (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
                )
                .first()
            )

            if existing_att:
                existing_att.site_id = site_id_to_save
                existing_att.work_units = a.work_units
                if a.notes is not None:
                    existing_att.notes = a.notes
                existing_att.account_id = current_account.id
                synced_attendance += 1
            else:
                att_id = a.id if a.id else generate_uuid()
                att = Attendance(
                    id=att_id,
                    account_id=current_account.id,
                    worker_id=a.worker_id,
                    site_id=site_id_to_save,
                    date=a.date,
                    work_units=a.work_units,
                    notes=a.notes,
                )
                db.add(att)
                synced_attendance += 1
        except Exception as e:
            errors.append(f"Attendance error: {str(e)}")

    # 4. Process Advances
    for adv in payload.advances:
        try:
            worker_exists = db.query(Worker).filter(
                Worker.id == adv.worker_id,
                (Worker.account_id == current_account.id) | (Worker.account_id.is_(None)),
            ).first()
            if not worker_exists:
                errors.append(f"Advance error: Worker {adv.worker_id} not found")
                continue

            adv_id = adv.id if adv.id else generate_uuid()
            existing_adv = db.query(Advance).filter(Advance.id == adv_id).first()
            if existing_adv:
                if existing_adv.account_id and existing_adv.account_id != current_account.id:
                    errors.append(f"Advance error ({adv_id}): Cross-account modification forbidden")
                    continue
                existing_adv.worker_id = adv.worker_id
                existing_adv.amount = adv.amount
                existing_adv.date = adv.date
                existing_adv.note = adv.note
                existing_adv.account_id = current_account.id
            else:
                new_adv = Advance(
                    id=adv_id,
                    account_id=current_account.id,
                    worker_id=adv.worker_id,
                    amount=adv.amount,
                    date=adv.date,
                    note=adv.note,
                )
                db.add(new_adv)
            synced_advances += 1
        except Exception as e:
            errors.append(f"Advance error: {str(e)}")

    if len(errors) == 0:
        db.commit()
    else:
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(f"Commit error: {str(e)}")

    return SyncPushResponse(
        success=len(errors) == 0,
        synced_workers=synced_workers,
        synced_sites=synced_sites,
        synced_attendance=synced_attendance,
        synced_advances=synced_advances,
        errors=errors,
    )


@router.get("/pull", response_model=SyncPullResponse)
def sync_pull(
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Offline Synchronization Pull:
    Derives account ownership strictly from the authenticated JWT session.
    Returns complete server state for workers, sites, attendance, and advances.
    """
    workers = db.query(Worker).filter((Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).order_by(Worker.name.asc()).all()
    sites = db.query(Site).filter((Site.account_id == current_account.id) | (Site.account_id.is_(None))).order_by(Site.name.asc()).all()
    attendance = db.query(Attendance).filter((Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None))).order_by(Attendance.date.desc()).all()
    advances = db.query(Advance).filter((Advance.account_id == current_account.id) | (Advance.account_id.is_(None))).order_by(Advance.date.desc()).all()

    return SyncPullResponse(
        server_time=datetime.now(timezone.utc),
        workers=[WorkerResponse.model_validate(w) for w in workers],
        sites=[SiteResponse.model_validate(s) for s in sites],
        attendance=[build_attendance_response(db, a) for a in attendance],
        advances=[build_advance_response(a) for a in advances],
    )
