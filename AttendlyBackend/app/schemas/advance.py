from datetime import date as dt_date, datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator


class AdvanceCreate(BaseModel):
    id: Optional[str] = Field(None, description="Optional client-generated UUID for offline writes")
    worker_id: str = Field(..., description="Worker ID")
    amount: Decimal = Field(..., gt=0, description="Advance amount in rupees")
    date: dt_date = Field(..., description="Advance date (YYYY-MM-DD)")
    note: Optional[str] = Field(None, max_length=255, description="Optional note or reference")

    @field_validator("note")
    @classmethod
    def validate_note(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            cleaned = v.strip()
            if len(cleaned) > 255:
                raise ValueError("Note cannot exceed 255 characters")
            return cleaned or None
        return None


class AdvanceUpdate(BaseModel):
    amount: Optional[Decimal] = Field(None, gt=0)
    date: Optional[dt_date] = None
    note: Optional[str] = Field(None, max_length=255)

    @field_validator("note")
    @classmethod
    def validate_note(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            cleaned = v.strip()
            if len(cleaned) > 255:
                raise ValueError("Note cannot exceed 255 characters")
            return cleaned or None
        return None


class AdvanceResponse(BaseModel):
    id: str
    worker_id: str
    worker_name: Optional[str] = None
    account_id: Optional[str] = None
    amount: Decimal
    date: dt_date
    note: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
