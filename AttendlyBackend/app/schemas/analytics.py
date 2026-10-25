from datetime import date as dt_date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, Field
from app.schemas.payroll import WageRateBreakdown


class SiteDateWorkDetail(BaseModel):
    date: dt_date
    work_units: Decimal
    daily_wage: Decimal
    wage_earned: Decimal


class SiteWorkerDetail(BaseModel):
    worker_id: str
    worker_name: str
    daily_wage: Decimal
    work_units: Decimal
    labour_expense: Decimal
    wage_breakdown: List[WageRateBreakdown] = Field(default_factory=list)
    dates_worked: List[SiteDateWorkDetail] = Field(default_factory=list)


class SiteAnalyticsItem(BaseModel):
    site_id: str
    site_name: str
    location: Optional[str] = None
    is_active: bool
    unique_worker_count: int
    total_work_units: Decimal
    total_labour_expense: Decimal
    workers: List[SiteWorkerDetail] = Field(default_factory=list)


class MonthlySiteAnalyticsResponse(BaseModel):
    year: int
    month: int
    month_name: str
    total_sites_used: int
    total_unique_workers: int
    total_work_units: Decimal
    total_labour_expense: Decimal
    sites: List[SiteAnalyticsItem] = Field(default_factory=list)
