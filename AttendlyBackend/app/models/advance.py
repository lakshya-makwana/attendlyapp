from sqlalchemy import Column, String, Numeric, Date, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.common import generate_uuid, utc_now


class Advance(Base):
    __tablename__ = "advances"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    worker_id = Column(String(36), ForeignKey("workers.id", ondelete="CASCADE"), nullable=False, index=True)
    amount = Column(Numeric(10, 2), nullable=False)
    date = Column(Date, nullable=False, index=True)
    note = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    worker = relationship("Worker", back_populates="advances")
    account = relationship("Account")

    __table_args__ = (
        Index("ix_advances_worker_date", "worker_id", "date"),
    )
