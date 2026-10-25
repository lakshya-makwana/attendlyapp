from sqlalchemy import Column, String, Numeric, Date, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.common import generate_uuid, utc_now


class WorkerWageHistory(Base):
    __tablename__ = "worker_wage_history"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    worker_id = Column(String(36), ForeignKey("workers.id", ondelete="CASCADE"), nullable=False, index=True)
    daily_wage = Column(Numeric(10, 2), nullable=False)
    effective_from = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    account = relationship("Account")
    worker = relationship("Worker", back_populates="wage_history")

    __table_args__ = (
        UniqueConstraint("worker_id", "effective_from", name="uq_worker_wage_history_worker_effective_from"),
        Index("ix_worker_wage_history_worker_effective_from", "worker_id", "effective_from"),
    )
