from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator


class SiteCreate(BaseModel):
    id: Optional[str] = Field(None, description="Optional client-generated UUID for offline-first sync")
    name: str = Field(..., description="Site name")
    location: Optional[str] = Field(None, description="Site location / address landmark")
    address: Optional[str] = Field(None, description="PWA compatibility alias for location")
    active: bool = Field(True, description="Whether site is active")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Site name cannot be empty or whitespace only")
        if len(cleaned) > 100:
            raise ValueError("Site name cannot exceed 100 characters")
        return cleaned

    @field_validator("location", "address")
    @classmethod
    def validate_location(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            cleaned = v.strip()
            if len(cleaned) > 255:
                raise ValueError("Location cannot exceed 255 characters")
            return cleaned or None
        return None

    def resolved_location(self) -> Optional[str]:
        return self.location or self.address


class SiteUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            cleaned = v.strip()
            if not cleaned:
                raise ValueError("Site name cannot be empty or whitespace only")
            if len(cleaned) > 100:
                raise ValueError("Site name cannot exceed 100 characters")
            return cleaned
        return v

    @field_validator("location", "address")
    @classmethod
    def validate_location(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            cleaned = v.strip()
            if len(cleaned) > 255:
                raise ValueError("Location cannot exceed 255 characters")
            return cleaned or None
        return None

    def resolved_location(self) -> Optional[str]:
        return self.location or self.address


class SiteResponse(BaseModel):
    id: str
    name: str
    location: Optional[str] = None
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
