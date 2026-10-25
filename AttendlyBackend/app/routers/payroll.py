import calendar
from datetime import date
from decimal import Decimal
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models.account import Account
from app.models.worker import Worker
from app.models.site import Site
from app.models.attendance import Attendance
from app.models.advance import Advance
from app.core.dependencies import get_current_account
from app.schemas.payroll import (
    WageRateBreakdown,
    WorkerPayrollRow,
    MonthlyPayrollResponse,
    DashboardSummaryResponse,
)
from app.services.wage_service import (
    resolve_effective_wage_from_list,
    get_worker_wages_map,
    compute_wage_breakdown,
)

router = APIRouter(tags=["Payroll & Dashboard"])


def compute_payroll_for_range(db: Session, start_d: date, end_d: date, account_id: Optional[str] = None):
    # Fetch all workers
    worker_query = db.query(Worker)
    if account_id:
        worker_query = worker_query.filter((Worker.account_id == account_id) | (Worker.account_id.is_(None)))
    workers = worker_query.order_by(Worker.name.asc()).all()

    # Query attendance in date range
    att_query = db.query(Attendance).filter(
        Attendance.date >= start_d,
        Attendance.date <= end_d,
    )
    if account_id:
        att_query = att_query.filter((Attendance.account_id == account_id) | (Attendance.account_id.is_(None)))
    attendances = att_query.all()

    # Query advances in date range
    adv_query = db.query(Advance).filter(
        Advance.date >= start_d,
        Advance.date <= end_d,
    )
    if account_id:
        adv_query = adv_query.filter((Advance.account_id == account_id) | (Advance.account_id.is_(None)))
    advances = adv_query.all()

    # Batch load worker wages map to eliminate N+1 queries
    wages_map = get_worker_wages_map(db, (w.id for w in workers))

    att_by_worker: dict[str, list] = {}
    for att in attendances:
        att_by_worker.setdefault(att.worker_id, []).append(att)

    adv_by_worker: dict[str, list] = {}
    for adv in advances:
        adv_by_worker.setdefault(adv.worker_id, []).append(adv)

    rows: List[WorkerPayrollRow] = []
    total_gross = Decimal("0.00")
    total_adv = Decimal("0.00")
    total_net = Decimal("0.00")
    overall_work_units = Decimal("0.0")

    for w in workers:
        w_atts = att_by_worker.get(w.id, [])
        w_advs = adv_by_worker.get(w.id, [])
        w_wages = wages_map.get(w.id, [])
        fallback_wage = Decimal(str(w.daily_wage)) if w.daily_wage is not None else Decimal("0.00")

        worker_work_units = sum((Decimal(str(a.work_units)) for a in w_atts), Decimal("0.0"))

        gross = Decimal("0.00")
        for a in w_atts:
            eff_rate = resolve_effective_wage_from_list(w_wages, a.date, fallback_wage)
            gross += (Decimal(str(a.work_units)) * eff_rate).quantize(Decimal("0.01"))

        adv_sum = sum((Decimal(str(a.amount)) for a in w_advs), Decimal("0.00")).quantize(Decimal("0.01"))
        net = (gross - adv_sum).quantize(Decimal("0.01"))

        # Compute wage breakdown for month
        breakdown_raw = compute_wage_breakdown(w_atts, w_wages, fallback_wage)
        wage_breakdown = [
            WageRateBreakdown(
                rate=b["rate"],
                work_units=b["work_units"],
                earnings=b["earnings"],
            )
            for b in breakdown_raw
        ]

        # Display wage: latest effective rate on end_d, or fallback
        display_wage = resolve_effective_wage_from_list(w_wages, end_d, fallback_wage)

        # Include if active, or if worker had any attendance or advances this month (PWA rule)
        if w.active or len(w_atts) > 0 or len(w_advs) > 0:
            row = WorkerPayrollRow(
                worker_id=w.id,
                worker_name=w.name,
                phone=w.phone,
                daily_wage=display_wage,
                total_work_units=worker_work_units,
                gross_earnings=gross,
                total_advances=adv_sum,
                net_payable=net,
                wage_breakdown=wage_breakdown,
            )
            rows.append(row)

            total_gross += gross
            total_adv += adv_sum
            total_net += net
            overall_work_units += worker_work_units

    return {
        "total_gross": total_gross,
        "total_advances": total_adv,
        "total_net": total_net,
        "total_work_units": overall_work_units,
        "rows": rows,
        "worker_count": len(rows),
    }


@router.get("/payroll/monthly", response_model=MonthlyPayrollResponse)
def get_monthly_payroll(
    year: Optional[int] = Query(None, description="Year (e.g. 2026)"),
    month: Optional[int] = Query(None, ge=1, le=12, description="Month (1-12)"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    today = date.today()
    target_year = year if year is not None else today.year
    target_month = month if month is not None else today.month

    _, last_day = calendar.monthrange(target_year, target_month)
    start_date = date(target_year, target_month, 1)
    end_date = date(target_year, target_month, last_day)

    computed = compute_payroll_for_range(db, start_date, end_date, current_account.id)
    month_name = start_date.strftime("%B %Y")

    return MonthlyPayrollResponse(
        year=target_year,
        month=target_month,
        month_name=month_name,
        start_date=start_date,
        end_date=end_date,
        total_gross_wages=computed["total_gross"],
        total_advances=computed["total_advances"],
        total_net_payable=computed["total_net"],
        total_work_units=computed["total_work_units"],
        worker_count=computed["worker_count"],
        rows=computed["rows"],
        total_gross=computed["total_gross"],
        workers=computed["rows"],
    )


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    today = date.today()
    _, last_day = calendar.monthrange(today.year, today.month)
    month_start = date(today.year, today.month, 1)
    month_end = date(today.year, today.month, last_day)

    active_workers = db.query(Worker).filter(
        Worker.active.is_(True),
        (Worker.account_id == current_account.id) | (Worker.account_id.is_(None)),
    ).all()
    active_workers_count = len(active_workers)

    active_sites_count = db.query(Site).filter(
        Site.active.is_(True),
        (Site.account_id == current_account.id) | (Site.account_id.is_(None)),
    ).count()

    today_attendance = db.query(Attendance).filter(
        Attendance.date == today,
        (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
    ).all()

    present_count = sum(1 for a in today_attendance if float(a.work_units) > 0)
    absent_count = max(0, active_workers_count - present_count)

    # Use compute_payroll_for_range to guarantee exact parity between Dashboard and Payroll!
    month_payroll = compute_payroll_for_range(db, month_start, month_end, current_account.id)

    return DashboardSummaryResponse(
        today=today,
        today_present_workers=present_count,
        today_absent_workers=absent_count,
        active_workers_count=active_workers_count,
        active_sites_count=active_sites_count,
        current_month_gross=month_payroll["total_gross"],
        current_month_advances=month_payroll["total_advances"],
        current_month_net_payable=month_payroll["total_net"],
    )
