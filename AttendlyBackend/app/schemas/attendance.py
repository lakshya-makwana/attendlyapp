from datetime import date as dt_date, datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator, ConfigDict

ALLOWED_WORK_UNITS = {
    Decimal("0.0"),
    Decimal("0.5"),
    Decimal("1.0"),
    Decimal("1.5"),
    Decimal("2.0"),
}


def normalize_work_units(v: float | int | str | Decimal) -> Decimal:
    try:
        dec = Decimal(str(v)).quantize(Decimal("0.1"))
        if dec not in ALLOWED_WORK_UNITS:
            raise ValueError(f"work_units must be one of [0, 0.5, 1, 1.5, 2], got {v}")
        return dec
    except Exception as e:
        if isinstance(e, ValueError):
            raise
        raise ValueError(f"Invalid work_units value: {v}")


class AttendanceCreate(BaseModel):
    id: Optional[str] = Field(None, description="Optional client-generated UUID for offline-first sync")
    worker_id: str = Field(..., description="Worker ID")
    site_id: Optional[str] = Field(None, description="Site ID (optional when work_units is 0 / absent)")
    date: dt_date = Field(..., description="Attendance date (YYYY-MM-DD)")
    work_units: Decimal = Field(..., description="Work units: 0, 0.5, 1, 1.5, 2")
    notes: Optional[str] = Field(None, max_length=255)

    @field_validator("work_units")
    @classmethod
    def validate_work_units(cls, v) -> Decimal:
        return normalize_work_units(v)


class AttendanceUpdate(BaseModel):
    site_id: Optional[str] = None
    work_units: Optional[Decimal] = None
    date: Optional[dt_date] = None
    notes: Optional[str] = None

    @field_validator("work_units")
    @classmethod
    def validate_work_units(cls, v) -> Optional[Decimal]:
        if v is not None:
            return normalize_work_units(v)
        return None


class SiteSummary(BaseModel):
    id: str
    name: str
    active: bool
    model_config = ConfigDict(from_attributes=True)


class WorkerSummary(BaseModel):
    id: str
    name: str
    active: bool
    model_config = ConfigDict(from_attributes=True)


class AttendanceResponse(BaseModel):
    id: str
    worker_id: str
    worker_name: Optional[str] = None
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    date: dt_date
    work_units: float
    effective_daily_wage: Decimal
    daily_earnings: Decimal
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    worker: Optional[WorkerSummary] = None
    site: Optional[SiteSummary] = None

    model_config = ConfigDict(from_attributes=True)


# --- Batch Save & Daily Roster Schemas (PWA Feature Parity) ---
class AttendanceRecordCreate(BaseModel):
    worker_id: str
    site_id: Optional[str] = None
    work_units: Decimal = Field(..., description="0, 0.5, 1, 1.5, or 2")
    notes: Optional[str] = None

    @field_validator("work_units")
    @classmethod
    def validate_work_units(cls, v) -> Decimal:
        return normalize_work_units(v)


class AttendanceBatchSaveRequest(BaseModel):
    date: dt_date
    records: List[AttendanceRecordCreate]


class DailyAttendanceRow(BaseModel):
    worker_id: str
    worker_name: str
    daily_wage: Decimal
    phone: Optional[str] = None
    is_active: bool = True
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    work_units: Optional[float] = None
    notes: Optional[str] = None


class DailyAttendanceResponse(BaseModel):
    date: dt_date
    total_workers: int
    marked_count: int
    unmarked_count: int
    total_work_units: Decimal
    workers: List[DailyAttendanceRow]

