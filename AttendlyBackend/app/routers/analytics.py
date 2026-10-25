import calendar
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional, List, Dict
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.account import Account
from app.models.worker import Worker
from app.models.site import Site
from app.models.attendance import Attendance
from app.core.dependencies import get_current_account
from app.schemas.payroll import WageRateBreakdown
from app.schemas.analytics import (
    MonthlySiteAnalyticsResponse,
    SiteAnalyticsItem,
    SiteWorkerDetail,
    SiteDateWorkDetail,
)
from app.services.wage_service import (
    resolve_effective_wage_from_list,
    get_worker_wages_map,
    compute_wage_breakdown,
)

router = APIRouter(prefix="/sites/analytics", tags=["Site Analytics"])


@router.get("", response_model=MonthlySiteAnalyticsResponse)
def get_site_monthly_analytics(
    year: Optional[int] = Query(None, description="Target calendar year (e.g. 2026)"),
    month: Optional[int] = Query(None, ge=1, le=12, description="Target calendar month (1-12)"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Get comprehensive monthly site workforce deployment and wage analytics matching PWA parity.
    Preloads all worker wage histories in a single batched query to prevent N+1 queries.
    Preserves historical site attribution even after a site is deactivated or renamed.
    """
    today = datetime.now(timezone.utc).date()
    target_year = year or today.year
    target_month = month or today.month

    _, last_day = calendar.monthrange(target_year, target_month)
    start_d = date(target_year, target_month, 1)
    end_d = date(target_year, target_month, last_day)

    # All sites (active and inactive to preserve historical records)
    sites = (
        db.query(Site)
        .filter((Site.account_id == current_account.id) | (Site.account_id.is_(None)))
        .order_by(Site.name.asc())
        .all()
    )

    # Query attendances in date range where site_id is not null and work_units > 0
    attendances = (
        db.query(Attendance)
        .join(Worker, Attendance.worker_id == Worker.id)
        .filter(
            Attendance.site_id.isnot(None),
            Attendance.work_units > Decimal("0"),
            Attendance.date >= start_d,
            Attendance.date <= end_d,
            (Attendance.account_id == current_account.id) | (Attendance.account_id.is_(None)),
        )
        .order_by(Attendance.date.asc(), Attendance.id.asc())
        .all()
    )

    # Preload worker wages for all involved workers in one batch
    unique_worker_ids = list({att.worker_id for att in attendances})
    wages_map = get_worker_wages_map(db, unique_worker_ids)

    # Map worker object by id
    workers_by_id: Dict[str, Worker] = {}
    for att in attendances:
        if att.worker and att.worker_id not in workers_by_id:
            workers_by_id[att.worker_id] = att.worker

    # Group attendances by site_id
    site_att_map: Dict[str, List[Attendance]] = {}
    for att in attendances:
        if att.site_id:
            site_att_map.setdefault(att.site_id, []).append(att)

    site_items: List[SiteAnalyticsItem] = []
    overall_total_work_units = Decimal("0.0")
    overall_total_expense = Decimal("0.00")
    all_unique_worker_ids = set()
    sites_used_count = 0

    for s in sites:
        att_list = site_att_map.get(s.id, [])

        # Group by worker_id for this site
        worker_records: Dict[str, List[Attendance]] = {}
        for a in att_list:
            worker_records.setdefault(a.worker_id, []).append(a)
            all_unique_worker_ids.add(a.worker_id)

        site_work_units = Decimal("0.0")
        site_expense = Decimal("0.00")
        workers_detail_list: List[SiteWorkerDetail] = []

        for w_id, w_atts in worker_records.items():
            worker = workers_by_id.get(w_id) or w_atts[0].worker
            w_wages = wages_map.get(w_id, [])
            fallback_wage = Decimal(str(worker.daily_wage)) if worker and worker.daily_wage is not None else Decimal("0.00")

            w_units = sum((Decimal(str(a.work_units)) for a in w_atts), Decimal("0.0"))
            w_expense = Decimal("0.00")
            dates_worked: List[SiteDateWorkDetail] = []

            for a in w_atts:
                a_units = Decimal(str(a.work_units))
                eff_rate = resolve_effective_wage_from_list(w_wages, a.date, fallback_wage)
                a_earned = (a_units * eff_rate).quantize(Decimal("0.01"))
                w_expense += a_earned
                dates_worked.append(
                    SiteDateWorkDetail(
                        date=a.date,
                        work_units=a_units,
                        daily_wage=eff_rate,
                        wage_earned=a_earned,
                    )
                )

            site_work_units += w_units
            site_expense += w_expense

            breakdown_raw = compute_wage_breakdown(w_atts, w_wages, fallback_wage)
            wage_breakdown = [
                WageRateBreakdown(
                    rate=b["rate"],
                    work_units=b["work_units"],
                    earnings=b["earnings"],
                )
                for b in breakdown_raw
            ]

            display_wage = resolve_effective_wage_from_list(w_wages, end_d, fallback_wage)

            workers_detail_list.append(
                SiteWorkerDetail(
                    worker_id=w_id,
                    worker_name=worker.name if worker else "Unknown",
                    daily_wage=display_wage,
                    work_units=w_units,
                    labour_expense=w_expense,
                    wage_breakdown=wage_breakdown,
                    dates_worked=dates_worked,
                )
            )

        # Sort workers within site by labour expense descending
        workers_detail_list.sort(key=lambda w: w.labour_expense, reverse=True)

        if len(att_list) > 0:
            sites_used_count += 1

        overall_total_work_units += site_work_units
        overall_total_expense += site_expense

        site_items.append(
            SiteAnalyticsItem(
                site_id=s.id,
                site_name=s.name,
                location=s.location,
                is_active=s.active,
                unique_worker_count=len(worker_records),
                total_work_units=site_work_units,
                total_labour_expense=site_expense,
                workers=workers_detail_list,
            )
        )

    month_name = start_d.strftime("%B %Y")

    return MonthlySiteAnalyticsResponse(
        year=target_year,
        month=target_month,
        month_name=month_name,
        total_sites_used=sites_used_count,
        total_unique_workers=len(all_unique_worker_ids),
        total_work_units=overall_total_work_units,
        total_labour_expense=overall_total_expense,
        sites=site_items,
    )
