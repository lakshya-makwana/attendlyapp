from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.common import generate_uuid, utc_now


class Site(Base):
    __tablename__ = "sites"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    location = Column(String(255), nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    account = relationship("Account")
    attendance = relationship("Attendance", back_populates="site")
