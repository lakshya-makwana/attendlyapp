from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator


class WorkerCreate(BaseModel):
    id: Optional[str] = Field(None, description="Optional client-generated UUID for offline-first sync")
    name: str = Field(..., description="Worker full name")
    phone: Optional[str] = Field(None, description="Optional worker phone number")
    daily_wage: Decimal = Field(..., ge=0, description="Daily wage amount in rupees")
    effective_from: Optional[date] = Field(
        None,
        description="Effective start date for initial wage rate. Defaults to current date if omitted.",
    )
    active: bool = Field(True, description="Whether worker is active on roster")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Worker name cannot be empty or whitespace only")
        if len(cleaned) > 100:
            raise ValueError("Worker name cannot exceed 100 characters")
        return cleaned

    @field_validator("daily_wage")
    @classmethod
    def validate_daily_wage(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Daily wage must be greater than zero")
        if v.as_tuple().exponent < -2:
            raise ValueError("Daily wage cannot have more than 2 decimal places")
        return Decimal(str(v)).quantize(Decimal("0.01"))


class WorkerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    daily_wage: Optional[Decimal] = Field(None, gt=0)
    effective_from: Optional[date] = Field(
        None,
        description="If daily_wage is updated, optional effective date for the new rate",
    )
    active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            cleaned = v.strip()
            if not cleaned:
                raise ValueError("Worker name cannot be empty or whitespace only")
            if len(cleaned) > 100:
                raise ValueError("Worker name cannot exceed 100 characters")
            return cleaned
        return v

    @field_validator("daily_wage")
    @classmethod
    def validate_daily_wage(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v <= 0:
                raise ValueError("Daily wage must be greater than zero")
            if v.as_tuple().exponent < -2:
                raise ValueError("Daily wage cannot have more than 2 decimal places")
            return Decimal(str(v)).quantize(Decimal("0.01"))
        return v


class WageHistoryCreate(BaseModel):
    daily_wage: Decimal = Field(..., gt=0, description="Daily wage amount, must be greater than zero")
    effective_from: date = Field(..., description="Effective start date")

    @field_validator("daily_wage")
    @classmethod
    def validate_daily_wage(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Daily wage must be greater than zero")
        if v.as_tuple().exponent < -2:
            raise ValueError("Daily wage cannot have more than 2 decimal places")
        return Decimal(str(v)).quantize(Decimal("0.01"))


class WageHistoryResponse(BaseModel):
    id: str
    worker_id: str
    daily_wage: Decimal
    effective_from: date
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkerResponse(BaseModel):
    id: str
    name: str
    phone: Optional[str] = None
    daily_wage: Decimal
    active: bool
    created_at: datetime
    updated_at: datetime
    wage_history: Optional[List[WageHistoryResponse]] = None

    model_config = ConfigDict(from_attributes=True)
