from datetime import date as dt_date
from decimal import Decimal
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.database import get_db
from app.models.account import Account
from app.models.attendance import Attendance
from app.models.worker import Worker
from app.models.site import Site
from app.core.dependencies import get_current_account
from app.services.wage_service import resolve_effective_wage, calculate_daily_earnings
from app.schemas.attendance import (
    AttendanceCreate,
    AttendanceUpdate,
    AttendanceResponse,
    WorkerSummary,
    SiteSummary,
    AttendanceBatchSaveRequest,
    DailyAttendanceResponse,
    DailyAttendanceRow,
)

router = APIRouter(prefix="/attendance", tags=["Attendance"])


def build_attendance_response(db: Session, att: Attendance) -> AttendanceResponse:
    wage = resolve_effective_wage(db, att.worker_id, att.date) or Decimal("0.00")
    earnings = calculate_daily_earnings(Decimal(str(att.work_units)), wage)
    return AttendanceResponse(
        id=att.id,
        worker_id=att.worker_id,
        worker_name=att.worker.name if att.worker else None,
        site_id=att.site_id,
        site_name=att.site.name if att.site else None,
        date=att.date,
        work_units=float(att.work_units),
        effective_daily_wage=wage,
        daily_earnings=earnings,
        notes=att.notes,
        created_at=att.created_at,
        updated_at=att.updated_at,
        worker=WorkerSummary.model_validate(att.worker) if att.worker else None,
        site=SiteSummary.model_validate(att.site) if att.site else None,
    )


@router.get("/by-date", response_model=DailyAttendanceResponse)
def get_daily_attendance(
    target_date: Optional[dt_date] = Query(default=None, alias="date"),
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_account: Account = Depends(get_current_account),
):
    """
    Retrieve attendance roster for a specific date (PWA Parity).
    Returns all active workers, with their effective daily wage and existing attendance records.
    """
    selected_date = target_date or dt_date.today()

    records = (
        db.query(Attendance)
        .filter(
            Attendance.date == selected_date,
            (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
        )
        .all()
    )
    record_map = {r.worker_id: r for r in records}

    workers_base = db.query(Worker).filter((Worker.account_id == current_account.id) | (Worker.account_id.is_(None)))
    if active_only:
        workers = workers_base.filter(Worker.active == True).order_by(Worker.name.asc()).all()
    elif record_map:
        workers = (
            workers_base
            .filter(or_(Worker.active == True, Worker.id.in_(list(record_map.keys()))))
            .order_by(Worker.name.asc())
            .all()
        )
    else:
        workers = workers_base.filter(Worker.active == True).order_by(Worker.name.asc()).all()

    sites = db.query(Site).filter((Site.account_id == current_account.id) | (Site.account_id.is_(None))).all()
    site_map = {s.id: s.name for s in sites}

    rows = []
    total_units = Decimal("0.0")
    marked_cnt = 0

    for w in workers:
        eff_wage = resolve_effective_wage(db, w.id, selected_date) or w.daily_wage or Decimal("0.00")
        rec = record_map.get(w.id)
        if rec:
            marked_cnt += 1
            units = Decimal(str(rec.work_units))
            total_units += units
            rows.append(
                DailyAttendanceRow(
                    worker_id=w.id,
                    worker_name=w.name,
                    phone=getattr(w, "phone", None),
                    daily_wage=eff_wage,
                    is_active=w.active,
                    site_id=rec.site_id,
                    site_name=site_map.get(rec.site_id) if rec.site_id else None,
                    work_units=float(units),
                    notes=rec.notes,
                )
            )
        else:
            rows.append(
                DailyAttendanceRow(
                    worker_id=w.id,
                    worker_name=w.name,
                    phone=getattr(w, "phone", None),
                    daily_wage=eff_wage,
                    is_active=w.active,
                    site_id=None,
                    site_name=None,
                    work_units=None,
                    notes=None,
                )
            )

    unmarked_cnt = len(workers) - marked_cnt

    return DailyAttendanceResponse(
        date=selected_date,
        total_workers=len(workers),
        marked_count=marked_cnt,
        unmarked_count=unmarked_cnt,
        total_work_units=total_units,
        workers=rows,
    )


@router.post("/batch-save", status_code=status.HTTP_200_OK)
def batch_save_attendance(
    payload: AttendanceBatchSaveRequest,
    db: Session = Depends(get_db),
    current_account: Account = Depends(get_current_account),
):
    """
    Batch save attendance records for a target date (PWA Parity).
    Upserts attendance non-destructively, preserving historical audit integrity.
    """
    target_date = payload.date
    saved_count = 0

    for item in payload.records:
        worker = db.query(Worker).filter(Worker.id == item.worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
        if not worker:
            continue

        existing = (
            db.query(Attendance)
            .filter(
                Attendance.worker_id == item.worker_id,
                Attendance.date == target_date,
                (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
            )
            .first()
        )

        units = Decimal(str(item.work_units)).quantize(Decimal("0.1"))

        site_id_to_save = None
        if units > Decimal("0") and item.site_id:
            site = db.query(Site).filter(Site.id == item.site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
            if site:
                site_id_to_save = site.id

        if existing:
            existing.work_units = units
            existing.site_id = site_id_to_save
            existing.notes = item.notes
            existing.account_id = current_account.id
        else:
            new_att = Attendance(
                account_id=current_account.id,
                worker_id=item.worker_id,
                site_id=site_id_to_save,
                date=target_date,
                work_units=units,
                notes=item.notes,
            )
            db.add(new_att)

        saved_count += 1

    db.commit()
    return {"message": f"Successfully saved attendance for {saved_count} workers on {target_date}."}


@router.get("", response_model=List[AttendanceResponse])
def get_attendance(
    attendance_date: Optional[dt_date] = Query(None, alias="date", description="Filter by exact date (YYYY-MM-DD)"),
    start_date: Optional[dt_date] = Query(None, description="Start date inclusive (YYYY-MM-DD)"),
    end_date: Optional[dt_date] = Query(None, description="End date inclusive (YYYY-MM-DD)"),
    worker_id: Optional[str] = Query(None, description="Filter by worker ID"),
    site_id: Optional[str] = Query(None, description="Filter by site ID"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve attendance records filtered by date, date range, worker, or site.
    Returns per-worker site assignment and calculated daily earnings based on effective wage.
    """
    query = db.query(Attendance).filter((Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)))
    if attendance_date:
        query = query.filter(Attendance.date == attendance_date)
    if start_date:
        query = query.filter(Attendance.date >= start_date)
    if end_date:
        query = query.filter(Attendance.date <= end_date)
    if worker_id:
        query = query.filter(Attendance.worker_id == worker_id)
    if site_id:
        query = query.filter(Attendance.site_id == site_id)

    records = query.order_by(Attendance.date.desc(), Attendance.created_at.asc()).all()
    return [build_attendance_response(db, r) for r in records]


@router.get("/worker/{worker_id}", response_model=List[AttendanceResponse])
def get_worker_attendance_history(
    worker_id: str,
    start_date: Optional[dt_date] = Query(None, description="Start date inclusive (YYYY-MM-DD)"),
    end_date: Optional[dt_date] = Query(None, description="End date inclusive (YYYY-MM-DD)"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve complete attendance history for a single worker.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    query = db.query(Attendance).filter(Attendance.worker_id == worker_id, (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)))
    if start_date:
        query = query.filter(Attendance.date >= start_date)
    if end_date:
        query = query.filter(Attendance.date <= end_date)

    records = query.order_by(Attendance.date.desc()).all()
    return [build_attendance_response(db, r) for r in records]


@router.get("/{attendance_id}", response_model=AttendanceResponse)
def get_attendance_record(
    attendance_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve a single attendance record by ID.
    """
    att = db.query(Attendance).filter(Attendance.id == attendance_id, (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None))).first()
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")
    return build_attendance_response(db, att)


@router.post("", response_model=AttendanceResponse, status_code=status.HTTP_201_CREATED)
def record_attendance(
    att_in: AttendanceCreate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Create an attendance record with independent per-worker site selection.
    Strictly validates allowed work units (0, 0.5, 1, 1.5, 2), active status of worker and site,
    resolves effective wage, and rejects duplicate (worker, date) entries.
    """
    # 1. Validate worker exists and is active, and belongs to current account
    worker = db.query(Worker).filter(Worker.id == att_in.worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    if not worker.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot record attendance for an inactive worker",
        )

    # 2. Validate site exists and is active when work_units > 0, and belongs to current account
    site_id_to_save = None
    if att_in.work_units > Decimal("0"):
        if not att_in.site_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Site ID is required when work units are greater than 0",
            )
        site = db.query(Site).filter(Site.id == att_in.site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
        if not site:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
        if not site.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot record attendance for an inactive site",
            )
        site_id_to_save = site.id
    else:
        # For absent records (0 units), site is optional/nullable
        if att_in.site_id:
            site = db.query(Site).filter(Site.id == att_in.site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
            if not site:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
            site_id_to_save = site.id

    # 3. Prevent duplicate records for the same worker and date
    existing = (
        db.query(Attendance)
        .filter(
            Attendance.worker_id == att_in.worker_id,
            Attendance.date == att_in.date,
            (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attendance record already exists for this worker on this date. Use PUT to update.",
        )

    # 4. Resolve effective wage for target date
    effective_wage = resolve_effective_wage(db, att_in.worker_id, att_in.date)
    if effective_wage is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No applicable wage rate found for worker on or before {att_in.date}. Please add a wage history entry first.",
        )

    # 5. Persist record
    attendance = Attendance(
        id=att_in.id if att_in.id else None,
        account_id=current_account.id,
        worker_id=att_in.worker_id,
        site_id=site_id_to_save,
        date=att_in.date,
        work_units=att_in.work_units,
        notes=att_in.notes,
    )
    db.add(attendance)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attendance record already exists for this worker on this date.",
        )

    db.refresh(attendance)
    return build_attendance_response(db, attendance)


@router.put("/{attendance_id}", response_model=AttendanceResponse)
@router.patch("/{attendance_id}", response_model=AttendanceResponse)
def update_attendance(
    attendance_id: str,
    att_in: AttendanceUpdate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Update an existing attendance record (site assignment, work units, or date).
    Changing one worker's site does not alter another worker's record.
    Changing site does not alter wage or work units.
    """
    att = db.query(Attendance).filter(Attendance.id == attendance_id, (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None))).first()
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")

    # If updating site_id, validate new site exists and is active (unless unchanged or setting to None)
    if att_in.site_id is not None and att_in.site_id != att.site_id:
        new_site = db.query(Site).filter(Site.id == att_in.site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
        if not new_site:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
        if not new_site.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot assign an inactive site to attendance",
            )
        att.site_id = att_in.site_id

    # If updating work_units
    if att_in.work_units is not None:
        att.work_units = att_in.work_units
        if att.work_units == Decimal("0") and att_in.site_id is None:
            # If changed to absent without specifying a site, site_id becomes None
            pass

    # If updating notes
    if att_in.notes is not None:
        att.notes = att_in.notes

    # If updating date, verify no duplicate and verify applicable wage exists for the new date
    if att_in.date is not None and att_in.date != att.date:
        existing = (
            db.query(Attendance)
            .filter(
                Attendance.worker_id == att.worker_id,
                Attendance.date == att_in.date,
                Attendance.id != att.id,
                (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Attendance record already exists for this worker on the target date",
            )
        new_wage = resolve_effective_wage(db, att.worker_id, att_in.date)
        if new_wage is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No applicable wage rate found for worker on or before {att_in.date}. Please add a wage history entry first.",
            )
        att.date = att_in.date

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attendance record already exists for this worker on the target date",
        )

    db.refresh(att)
    return build_attendance_response(db, att)


@router.delete("/{attendance_id}")
def delete_attendance(
    attendance_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Attendance deletion safety:
    Permanent deletion of attendance records is blocked to safeguard financial history and audit integrity.
    Contractors should correct records non-destructively by updating work_units to 0 (Absent) via PUT/PATCH.
    """
    att = db.query(Attendance).filter(Attendance.id == attendance_id, (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None))).first()
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Permanent deletion of attendance records is disabled to safeguard financial history. To correct an entry, update work_units to 0 (Absent) via PUT.",
    )

