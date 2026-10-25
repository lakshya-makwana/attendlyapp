from sqlalchemy import Column, String, DateTime
from app.database import Base
from app.models.common import generate_uuid, utc_now


class Account(Base):
    __tablename__ = "accounts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    phone_number = Column(String(20), unique=True, index=True, nullable=False)
    mpin_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
