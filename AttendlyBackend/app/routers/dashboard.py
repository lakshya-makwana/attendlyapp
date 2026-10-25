import calendar
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.account import Account
from app.models.worker import Worker
from app.models.site import Site
from app.models.attendance import Attendance
from app.models.advance import Advance
from app.core.dependencies import get_current_account
from app.services.wage_service import resolve_effective_wage, calculate_daily_earnings
from app.schemas.dashboard import (
    DashboardSummaryResponse,
    TodaySummary,
    MonthSummary,
    OverviewSummary,
    SiteBreakdownItem,
)

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(
    target_date: Optional[date] = Query(None, alias="date", description="Reference date for today's summary (defaults to UTC today)"),
    year: Optional[int] = Query(None, description="Selected year for monthly metrics"),
    month: Optional[int] = Query(None, description="Selected month (1-12) for monthly metrics"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve current dashboard summary:
    - Today's attendance, presence counts, marked workers, active sites, work units, and daily earnings.
    - Selected month's total work units, gross earnings, advances, net payable, and site-wise breakdown.
    - Overall overview of active and total workers and sites.
    """
    ref_date = target_date or datetime.now(timezone.utc).date()

    # 1. Overview counts
    active_workers_count = db.query(Worker).filter(Worker.active.is_(True), (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).count()
    total_workers_count = db.query(Worker).filter((Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).count()
    active_sites_count = db.query(Site).filter(Site.active.is_(True), (Site.account_id == current_account.id) | (Site.account_id.is_(None))).count()
    total_sites_count = db.query(Site).filter((Site.account_id == current_account.id) | (Site.account_id.is_(None))).count()

    overview = OverviewSummary(
        active_workers=active_workers_count,
        active_sites=active_sites_count,
        total_workers=total_workers_count,
        total_sites=total_sites_count,
    )

    # 2. Today's summary
    today_records = (
        db.query(Attendance)
        .filter(
            Attendance.date == ref_date,
            (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
        )
        .all()
    )
    today_marked_count = len(today_records)
    today_present = 0
    today_work_units = Decimal("0.0")
    today_earnings = Decimal("0.00")

    for att in today_records:
        units = Decimal(str(att.work_units))
        if units > Decimal("0.0"):
            today_present += 1
        today_work_units += units
        wage = resolve_effective_wage(db, att.worker_id, att.date) or Decimal("0.00")
        today_earnings += calculate_daily_earnings(units, wage)

    today_absent = max(0, active_workers_count - today_present)

    today_summary = TodaySummary(
        date=ref_date,
        active_workers=active_workers_count,
        present_workers=today_present,
        absent_workers=today_absent,
        marked_workers=today_marked_count,
        active_sites=active_sites_count,
        total_work_units=float(today_work_units),
        total_earnings=today_earnings.quantize(Decimal("0.01")),
    )

    # 3. Month summary (supports filtering by year & month)
    target_year = year or ref_date.year
    target_month = month or ref_date.month
    _, last_day = calendar.monthrange(target_year, target_month)
    first_date = date(target_year, target_month, 1)
    last_date = date(target_year, target_month, last_day)

    month_records = (
        db.query(Attendance)
        .filter(
            Attendance.date >= first_date,
            Attendance.date <= last_date,
            (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
        )
        .all()
    )

    month_work_units = Decimal("0.0")
    month_gross_earnings = Decimal("0.00")

    # Map for site breakdown: site_id -> { "unique_workers": set(), "units": Decimal("0.0"), "expense": Decimal("0.00") }
    site_att_stats = {}

    for att in month_records:
        units = Decimal(str(att.work_units))
        month_work_units += units
        wage = resolve_effective_wage(db, att.worker_id, att.date) or Decimal("0.00")
        earned = calculate_daily_earnings(units, wage)
        month_gross_earnings += earned

        if att.site_id:
            if att.site_id not in site_att_stats:
                site_att_stats[att.site_id] = {
                    "unique_workers": set(),
                    "units": Decimal("0.0"),
                    "expense": Decimal("0.00"),
                }
            if units > Decimal("0.0"):
                site_att_stats[att.site_id]["unique_workers"].add(att.worker_id)
            site_att_stats[att.site_id]["units"] += units
            site_att_stats[att.site_id]["expense"] += earned

    all_sites = (
        db.query(Site)
        .filter((Site.account_id == current_account.id) | (Site.account_id.is_(None)))
        .order_by(Site.name.asc())
        .all()
    )
    sites_breakdown = []
    for s in all_sites:
        stats = site_att_stats.get(s.id, {
            "unique_workers": set(),
            "units": Decimal("0.0"),
            "expense": Decimal("0.00"),
        })
        units_val = float(stats["units"])
        # Include site if it is active or has work units recorded in this month
        if s.active or units_val > 0:
            sites_breakdown.append(
                SiteBreakdownItem(
                    site_id=s.id,
                    site_name=s.name,
                    is_active=s.active,
                    unique_worker_count=len(stats["unique_workers"]),
                    total_work_units=units_val,
                    total_labour_expense=stats["expense"].quantize(Decimal("0.01")),
                )
            )

    # Sort: sites with activity first, then by labour expense descending, then by name
    sites_breakdown.sort(key=lambda item: (item.total_work_units > 0, item.total_labour_expense), reverse=True)

    month_advances = (
        db.query(Advance)
        .filter(
            Advance.date >= first_date,
            Advance.date <= last_date,
            (Advance.account_id == current_account.id) | (Advance.account_id.is_(None)),
        )
        .all()
    )
    total_advances = sum((Decimal(str(a.amount)) for a in month_advances), Decimal("0.00"))
    net_payable = (month_gross_earnings - total_advances).quantize(Decimal("0.01"))

    month_summary = MonthSummary(
        year=target_year,
        month=target_month,
        start_date=first_date,
        end_date=last_date,
        total_work_units=float(month_work_units),
        gross_earnings=month_gross_earnings.quantize(Decimal("0.01")),
        total_advances=total_advances.quantize(Decimal("0.01")),
        net_payable=net_payable,
        sites_breakdown=sites_breakdown,
    )

    return DashboardSummaryResponse(
        today=today_summary,
        month=month_summary,
        overview=overview,
    )

