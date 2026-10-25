from datetime import datetime, timezone, date
from decimal import Decimal
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.account import Account
from app.models.worker import Worker
from app.models.worker_wage_history import WorkerWageHistory
from app.core.dependencies import get_current_account
from app.schemas.worker import (
    WorkerCreate,
    WorkerUpdate,
    WorkerResponse,
    WageHistoryCreate,
    WageHistoryResponse,
)
from app.schemas.payroll import (
    WorkerMonthlyDetailResponse,
    WageRateBreakdown,
    WorkerMonthlySiteBreakdown,
    WorkerMonthlyAttendanceItem,
    WorkerMonthlyAdvanceItem,
)


router = APIRouter(prefix="/workers", tags=["Workers"])


@router.get("", response_model=List[WorkerResponse])
def list_workers(
    include_inactive: bool = Query(False, description="Whether to include deactivated workers"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    List workers. Excludes deactivated workers by default unless include_inactive=True.
    """
    query = db.query(Worker).filter((Worker.account_id == current_account.id) | (Worker.account_id.is_(None)))
    if not include_inactive:
        query = query.filter(Worker.active.is_(True))
    return query.order_by(Worker.name.asc()).all()


@router.post("", response_model=WorkerResponse, status_code=status.HTTP_201_CREATED)
def create_worker(
    worker_in: WorkerCreate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Create a new worker. Automatically creates the initial WorkerWageHistory record
    using the provided initial wage and effective_from date (or current date if omitted).
    """
    # Check if a client-supplied UUID already exists
    if worker_in.id:
        existing = db.query(Worker).filter(Worker.id == worker_in.id).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Worker with ID '{worker_in.id}' already exists",
            )

    worker = Worker(
        id=worker_in.id if worker_in.id else None,
        account_id=current_account.id,
        name=worker_in.name,
        phone=worker_in.phone.strip() if worker_in.phone else None,
        daily_wage=worker_in.daily_wage,
        active=worker_in.active,
    )
    db.add(worker)
    db.flush()

    # Determine effective date for initial wage history
    effective_date = worker_in.effective_from or datetime.now(timezone.utc).date()

    initial_wage = WorkerWageHistory(
        account_id=current_account.id,
        worker_id=worker.id,
        daily_wage=worker.daily_wage,
        effective_from=effective_date,
    )
    db.add(initial_wage)
    db.commit()
    db.refresh(worker)

    return worker


@router.get("/{worker_id}", response_model=WorkerResponse)
def get_worker(
    worker_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve details for a single worker by ID, including wage history.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    return worker


@router.put("/{worker_id}", response_model=WorkerResponse)
@router.patch("/{worker_id}", response_model=WorkerResponse)
def update_worker(
    worker_id: str,
    worker_in: WorkerUpdate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Update worker details. If daily_wage is updated, an effective-dated wage-history
    record is created or updated for the specified effective_from date (or current date).
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    if worker_in.name is not None:
        worker.name = worker_in.name

    if worker_in.phone is not None:
        worker.phone = worker_in.phone.strip() if worker_in.phone else None

    if worker_in.active is not None:
        worker.active = worker_in.active

    if worker_in.daily_wage is not None:
        effective_date = worker_in.effective_from or datetime.now(timezone.utc).date()

        # Check if wage history already exists for this effective date
        existing_wh = (
            db.query(WorkerWageHistory)
            .filter(
                WorkerWageHistory.worker_id == worker.id,
                WorkerWageHistory.effective_from == effective_date,
            )
            .first()
        )
        if existing_wh:
            existing_wh.daily_wage = worker_in.daily_wage
        else:
            new_wh = WorkerWageHistory(
                account_id=current_account.id,
                worker_id=worker.id,
                daily_wage=worker_in.daily_wage,
                effective_from=effective_date,
            )
            db.add(new_wh)

        db.flush()

        # Re-evaluate worker's active daily_wage for today
        today = datetime.now(timezone.utc).date()
        wages = (
            db.query(WorkerWageHistory)
            .filter(WorkerWageHistory.worker_id == worker.id)
            .order_by(WorkerWageHistory.effective_from.asc(), WorkerWageHistory.id.asc())
            .all()
        )
        if wages:
            applicable = wages[0].daily_wage
            for w in wages:
                if w.effective_from <= today:
                    applicable = w.daily_wage
                else:
                    break
            worker.daily_wage = applicable

    db.commit()
    db.refresh(worker)
    return worker


@router.patch("/{worker_id}/toggle-status", response_model=WorkerResponse)
def toggle_worker_status(
    worker_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Toggle worker active status (active <-> inactive).
    Matches PWA PATCH /workers/{id}/toggle-status endpoint.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    worker.active = not worker.active
    db.commit()
    db.refresh(worker)
    return worker


@router.post("/{worker_id}/deactivate", response_model=WorkerResponse)
@router.put("/{worker_id}/deactivate", response_model=WorkerResponse)
def deactivate_worker(
    worker_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Deactivate a worker (removes from active attendance roster).
    Preserves all historical attendance, wage history, and future payroll references.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    worker.active = False
    db.commit()
    db.refresh(worker)
    return worker


@router.post("/{worker_id}/reactivate", response_model=WorkerResponse)
@router.put("/{worker_id}/reactivate", response_model=WorkerResponse)
def reactivate_worker(
    worker_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Reactivate a previously deactivated worker.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    worker.active = True
    db.commit()
    db.refresh(worker)
    return worker


@router.delete("/{worker_id}", status_code=status.HTTP_200_OK)
def delete_worker(
    worker_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Delete a worker. Soft deletes or removes if no dependent records violate constraints.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    db.delete(worker)
    db.commit()
    return {"message": "Worker deleted successfully"}


@router.get("/{worker_id}/wages", response_model=List[WageHistoryResponse])
@router.get("/{worker_id}/wage-history", response_model=List[WageHistoryResponse])
def get_worker_wage_history(
    worker_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve the complete effective-dated wage history for a worker, ordered newest first.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    return (
        db.query(WorkerWageHistory)
        .filter(WorkerWageHistory.worker_id == worker_id)
        .order_by(WorkerWageHistory.effective_from.desc())
        .all()
    )


@router.post("/{worker_id}/wages", response_model=WageHistoryResponse, status_code=status.HTTP_201_CREATED)
@router.post("/{worker_id}/wage-history", response_model=WageHistoryResponse, status_code=status.HTTP_201_CREATED)
def add_or_update_worker_wage(
    worker_id: str,
    wage_in: WageHistoryCreate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Add a new wage-history entry for a worker or update the rate if one already exists
    for the exact same effective_from date. Prevents duplicate wage-history rows.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    # Check if entry already exists for this effective date
    existing_entry = (
        db.query(WorkerWageHistory)
        .filter(
            WorkerWageHistory.worker_id == worker_id,
            WorkerWageHistory.effective_from == wage_in.effective_from,
        )
        .first()
    )

    if existing_entry:
        existing_entry.daily_wage = wage_in.daily_wage
        entry = existing_entry
    else:
        entry = WorkerWageHistory(
            account_id=current_account.id,
            worker_id=worker_id,
            daily_wage=wage_in.daily_wage,
            effective_from=wage_in.effective_from,
        )
        db.add(entry)

    db.flush()

    # Re-evaluate worker's active daily_wage for today (prevents future or retroactive rates from corrupting today's rate)
    today = datetime.now(timezone.utc).date()
    wages = (
        db.query(WorkerWageHistory)
        .filter(WorkerWageHistory.worker_id == worker_id)
        .order_by(WorkerWageHistory.effective_from.asc(), WorkerWageHistory.id.asc())
        .all()
    )
    if wages:
        applicable = wages[0].daily_wage
        for w in wages:
            if w.effective_from <= today:
                applicable = w.daily_wage
            else:
                break
        worker.daily_wage = applicable

    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{worker_id}/wages/{wage_id}", status_code=status.HTTP_200_OK)
def delete_worker_wage(
    worker_id: str,
    wage_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Delete a specific wage rate record for a worker.
    Rejects deletion if it is the worker's sole wage record (preserves baseline wage).
    Updates worker current daily wage to the latest rate effective on or before today.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    record = (
        db.query(WorkerWageHistory)
        .filter(
            WorkerWageHistory.id == wage_id,
            WorkerWageHistory.worker_id == worker_id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wage record not found")

    count = (
        db.query(WorkerWageHistory)
        .filter(WorkerWageHistory.worker_id == worker_id)
        .count()
    )
    if count <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the worker's sole wage record.",
        )

    db.delete(record)
    db.flush()

    # Sync worker.daily_wage with active rate for today
    today = datetime.now(timezone.utc).date()
    wages = (
        db.query(WorkerWageHistory)
        .filter(WorkerWageHistory.worker_id == worker_id)
        .order_by(WorkerWageHistory.effective_from.asc(), WorkerWageHistory.id.asc())
        .all()
    )
    if wages:
        applicable = wages[0].daily_wage
        for w in wages:
            if w.effective_from <= today:
                applicable = w.daily_wage
            else:
                break
        worker.daily_wage = applicable

    db.commit()
    return {"message": "Wage record deleted successfully"}


@router.get("/{worker_id}/monthly", response_model=WorkerMonthlyDetailResponse)
def get_worker_monthly_detail(
    worker_id: str,
    year: Optional[int] = Query(None, description="Year (e.g. 2026)"),
    month: Optional[int] = Query(None, ge=1, le=12, description="Month (1-12)"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Get detailed monthly payroll record for a specific worker, including site-wise breakdown,
    effective wage rates, gross earnings, advances, and net payable.
    """
    import calendar
    from decimal import Decimal
    from app.models.site import Site
    from app.models.attendance import Attendance
    from app.models.advance import Advance
    from app.services.wage_service import (
        resolve_effective_wage_from_list,
        get_worker_wages_map,
        compute_wage_breakdown,
    )

    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    today = datetime.now(timezone.utc).date()
    target_year = year if year is not None else today.year
    target_month = month if month is not None else today.month

    _, last_day = calendar.monthrange(target_year, target_month)
    start_d = date(target_year, target_month, 1)
    end_d = date(target_year, target_month, last_day)

    # Attendances with sites
    attendances = (
        db.query(Attendance)
        .filter(
            Attendance.worker_id == worker_id,
            Attendance.date >= start_d,
            Attendance.date <= end_d,
        )
        .order_by(Attendance.date.asc(), Attendance.id.asc())
        .all()
    )

    # Advances
    advances = (
        db.query(Advance)
        .filter(
            Advance.worker_id == worker_id,
            Advance.date >= start_d,
            Advance.date <= end_d,
        )
        .order_by(Advance.date.asc(), Advance.id.asc())
        .all()
    )

    wages_map = get_worker_wages_map(db, [worker_id])
    worker_wages = wages_map.get(worker_id, [])
    fallback_wage = Decimal(str(worker.daily_wage)) if worker.daily_wage is not None else Decimal("0.00")

    # Site map
    site_ids = {a.site_id for a in attendances if a.site_id}
    sites = db.query(Site).filter(Site.id.in_(list(site_ids))).all() if site_ids else []
    site_names = {s.id: s.name for s in sites}

    total_units = Decimal("0.0")
    gross_earnings = Decimal("0.00")
    site_map: dict[Optional[str], dict] = {}
    attendance_items = []

    for a in attendances:
        units = Decimal(str(a.work_units))
        total_units += units
        eff_wage = resolve_effective_wage_from_list(worker_wages, a.date, fallback_wage)
        earned = (units * eff_wage).quantize(Decimal("0.01"))
        gross_earnings += earned

        s_id = a.site_id
        s_name = site_names.get(s_id, "No site assigned") if s_id else "No site assigned"

        attendance_items.append(
            WorkerMonthlyAttendanceItem(
                id=a.id,
                date=a.date,
                site_id=s_id,
                site_name=s_name if s_id else None,
                work_units=units,
                daily_wage=eff_wage,
                earnings=earned,
            )
        )

        if units > Decimal("0.0"):
            if s_id not in site_map:
                site_map[s_id] = {
                    "site_id": s_id,
                    "site_name": s_name,
                    "work_units": Decimal("0.0"),
                    "earnings": Decimal("0.00"),
                }
            site_map[s_id]["work_units"] += units
            site_map[s_id]["earnings"] += earned

    advance_items = []
    total_advances = Decimal("0.00")
    for adv in advances:
        adv_amount = Decimal(str(adv.amount)).quantize(Decimal("0.01"))
        total_advances += adv_amount
        advance_items.append(
            WorkerMonthlyAdvanceItem(
                id=adv.id,
                date=adv.date,
                amount=adv_amount,
                note=adv.note,
            )
        )

    net_payable = (gross_earnings - total_advances).quantize(Decimal("0.01"))

    # Wage breakdown
    breakdown_raw = compute_wage_breakdown(attendances, worker_wages, fallback_wage)
    wage_breakdown = [
        WageRateBreakdown(rate=b["rate"], work_units=b["work_units"], earnings=b["earnings"])
        for b in breakdown_raw
    ]

    display_wage = resolve_effective_wage_from_list(worker_wages, end_d, fallback_wage)
    month_name = start_d.strftime("%B %Y")

    sites_worked = [
        WorkerMonthlySiteBreakdown(
            site_id=v["site_id"],
            site_name=v["site_name"],
            work_units=v["work_units"],
            earnings=v["earnings"],
        )
        for v in site_map.values()
    ]

    return WorkerMonthlyDetailResponse(
        worker_id=worker.id,
        worker_name=worker.name,
        phone=worker.phone,
        daily_wage=display_wage,
        is_active=worker.active,
        year=target_year,
        month=target_month,
        month_name=month_name,
        total_work_units=total_units,
        gross_earnings=gross_earnings,
        total_advances=total_advances,
        net_payable=net_payable,
        wage_breakdown=wage_breakdown,
        sites_worked=sites_worked,
        attendance=attendance_items,
        advances=advance_items,
    )


@router.get("/{worker_id}/detail")
def get_worker_detail(
    worker_id: str,
    db: Session = Depends(get_db),
    current_account: Account = Depends(get_current_account),
):
    """
    Get worker basic information, all-time advances, and recent attendance entries (PWA parity).
    """
    from app.models.attendance import Attendance
    from app.models.advance import Advance
    from app.models.site import Site
    from app.services.wage_service import (
        resolve_effective_wage_from_list,
        get_worker_wages_map,
    )
    from sqlalchemy import desc

    worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    wages_map = get_worker_wages_map(db, [worker_id])
    worker_wages = wages_map.get(worker_id, [])
    fallback_wage = Decimal(str(worker.daily_wage)) if worker.daily_wage is not None else Decimal("0.00")

    # All-time advances
    all_advances = db.query(Advance).filter(Advance.worker_id == worker_id).all()
    all_advances_sum = sum((Decimal(str(a.amount)) for a in all_advances), Decimal("0.00")).quantize(Decimal("0.01"))

    # Recent attendances (last 50)
    recent_att = (
        db.query(Attendance)
        .filter(Attendance.worker_id == worker_id)
        .order_by(desc(Attendance.date), desc(Attendance.created_at))
        .limit(50)
        .all()
    )

    site_ids = {a.site_id for a in recent_att if a.site_id}
    sites = db.query(Site).filter(Site.id.in_(list(site_ids))).all() if site_ids else []
    site_names = {s.id: s.name for s in sites}

    history_items = []
    for att in recent_att:
        units = Decimal(str(att.work_units))
        eff_wage = resolve_effective_wage_from_list(worker_wages, att.date, fallback_wage)
        earned = (units * eff_wage).quantize(Decimal("0.01"))
        history_items.append({
            "id": att.id,
            "date": att.date.isoformat(),
            "work_units": float(units),
            "daily_wage": float(eff_wage),
            "wage_earned": float(earned),
            "site_id": att.site_id,
            "site_name": site_names.get(att.site_id, "No site assigned") if att.site_id else None,
            "notes": att.notes,
        })

    today = datetime.now(timezone.utc).date()
    display_wage = resolve_effective_wage_from_list(worker_wages, today, fallback_wage)

    return {
        "worker": {
            "id": worker.id,
            "name": worker.name,
            "phone": worker.phone,
            "daily_wage": float(display_wage),
            "is_active": worker.active,
            "created_at": worker.created_at.isoformat() if worker.created_at else None,
        },
        "all_advances_sum": float(all_advances_sum),
        "recent_attendance": history_items,
    }


