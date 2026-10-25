from datetime import date as dt_date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, Field


class WageRateBreakdown(BaseModel):
    rate: Decimal
    work_units: Decimal
    earnings: Decimal


class WorkerPayrollRow(BaseModel):
    worker_id: str
    worker_name: str
    phone: Optional[str] = None
    daily_wage: Decimal
    total_work_units: Decimal
    gross_earnings: Decimal
    total_advances: Decimal
    net_payable: Decimal
    wage_breakdown: List[WageRateBreakdown] = Field(default_factory=list)

    # Backward compatibility properties
    @property
    def total_days(self) -> Decimal:
        return self.total_work_units




class MonthlyPayrollResponse(BaseModel):
    year: int
    month: int
    month_name: str
    start_date: dt_date
    end_date: dt_date
    total_gross_wages: Decimal
    total_advances: Decimal
    total_net_payable: Decimal
    total_work_units: Decimal
    worker_count: int
    rows: List[WorkerPayrollRow] = Field(default_factory=list)

    # Backward-compatibility aliases
    total_gross: Optional[Decimal] = None
    workers: Optional[List[WorkerPayrollRow]] = None

    def model_post_init(self, __context):
        if self.total_gross is None:
            self.total_gross = self.total_gross_wages
        if self.workers is None:
            self.workers = self.rows


class DashboardSummaryResponse(BaseModel):
    today: dt_date
    today_present_workers: int
    today_absent_workers: int
    active_workers_count: int
    active_sites_count: int
    current_month_gross: Decimal
    current_month_advances: Decimal
    current_month_net_payable: Decimal


class WorkerMonthlySiteBreakdown(BaseModel):
    site_id: Optional[str] = None
    site_name: str
    work_units: Decimal
    earnings: Decimal


class WorkerMonthlyAttendanceItem(BaseModel):
    id: str
    date: dt_date
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    work_units: Decimal
    daily_wage: Decimal
    earnings: Decimal


class WorkerMonthlyAdvanceItem(BaseModel):
    id: str
    date: dt_date
    amount: Decimal
    note: Optional[str] = None


class WorkerMonthlyDetailResponse(BaseModel):
    worker_id: str
    worker_name: str
    phone: Optional[str] = None
    daily_wage: Decimal
    is_active: bool = True
    year: int
    month: int
    month_name: str
    total_work_units: Decimal
    gross_earnings: Decimal
    total_advances: Decimal
    net_payable: Decimal
    wage_breakdown: List[WageRateBreakdown] = Field(default_factory=list)
    sites_worked: List[WorkerMonthlySiteBreakdown] = Field(default_factory=list)
    attendance: List[WorkerMonthlyAttendanceItem] = Field(default_factory=list)
    advances: List[WorkerMonthlyAdvanceItem] = Field(default_factory=list)

