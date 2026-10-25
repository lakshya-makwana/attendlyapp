from datetime import date
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class TodaySummary(BaseModel):
    date: date
    active_workers: int
    present_workers: int
    absent_workers: int
    marked_workers: int = 0
    active_sites: int = 0
    total_work_units: float
    total_earnings: Decimal

    model_config = ConfigDict(from_attributes=True)


class SiteBreakdownItem(BaseModel):
    site_id: str
    site_name: str
    is_active: bool
    unique_worker_count: int
    total_work_units: float
    total_labour_expense: Decimal

    model_config = ConfigDict(from_attributes=True)


class MonthSummary(BaseModel):
    year: int
    month: int
    start_date: date
    end_date: date
    total_work_units: float
    gross_earnings: Decimal
    total_advances: Decimal
    net_payable: Decimal
    sites_breakdown: List[SiteBreakdownItem] = []

    model_config = ConfigDict(from_attributes=True)


class OverviewSummary(BaseModel):
    active_workers: int
    active_sites: int
    total_workers: int
    total_sites: int

    model_config = ConfigDict(from_attributes=True)


class DashboardSummaryResponse(BaseModel):
    today: TodaySummary
    month: MonthSummary
    overview: OverviewSummary

    model_config = ConfigDict(from_attributes=True)

