import re
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, AliasChoices, field_validator, ConfigDict


class AccountSetupRequest(BaseModel):
    phone_number: str = Field(
        ...,
        validation_alias=AliasChoices("phone_number", "phone"),
        description="Contractor phone number",
    )
    mpin: str = Field(..., description="4-digit MPIN")
    confirm_mpin: str = Field(
        ...,
        validation_alias=AliasChoices("confirm_mpin", "confirmMpin"),
        description="Confirm 4-digit MPIN",
    )

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, v: str) -> str:
        cleaned = re.sub(r"[^\d+]", "", v)
        digits_only = re.sub(r"[^\d]", "", cleaned)
        if len(digits_only) < 10:
            raise ValueError("Phone number must contain at least 10 digits")
        return cleaned

    @field_validator("mpin")
    @classmethod
    def validate_mpin(cls, v: str) -> str:
        if not re.match(r"^\d{4}$", v):
            raise ValueError("MPIN must be exactly 4 numeric digits")
        return v

    @field_validator("confirm_mpin")
    @classmethod
    def validate_confirm_mpin(cls, v: str, info) -> str:
        if "mpin" in info.data and v != info.data["mpin"]:
            raise ValueError("MPIN and confirm MPIN do not match")
        return v


# Backward-compatible alias
AccountRegisterRequest = AccountSetupRequest


class AccountLoginRequest(BaseModel):
    mpin: str = Field(..., description="4-digit MPIN")
    device_id: Optional[str] = Field(None, description="Optional recognized device ID")

    @field_validator("mpin")
    @classmethod
    def validate_mpin(cls, v: str) -> str:
        if not re.match(r"^\d{4}$", v):
            raise ValueError("MPIN must be exactly 4 numeric digits")
        return v


# Backward-compatible alias
AccountLoginMpinRequest = AccountLoginRequest


class AccountResponse(BaseModel):
    id: str
    phone_number: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    account: AccountResponse


class AuthStatusResponse(BaseModel):
    is_setup: bool
    message: str
