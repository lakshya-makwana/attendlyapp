from datetime import date
from decimal import Decimal
from typing import Optional
from sqlalchemy import Column, String, Numeric, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.common import generate_uuid, utc_now


class Worker(Base):
    __tablename__ = "workers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    phone = Column(String(20), nullable=True)
    daily_wage = Column(Numeric(10, 2), nullable=False, default=0.0)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships - preserve historical attendance and wage history (no delete-orphan cascade)
    account = relationship("Account")
    attendance = relationship("Attendance", back_populates="worker")
    wage_history = relationship(
        "WorkerWageHistory",
        back_populates="worker",
        order_by="desc(WorkerWageHistory.effective_from)",
    )
    advances = relationship(
        "Advance",
        back_populates="worker",
        order_by="desc(Advance.date)",
    )

    def get_effective_wage(self, target_date: date) -> Decimal:
        """
        Resolve the wage using the latest effective_from date on or before target_date.
        If target_date is before the earliest recorded effective_from, falls back to
        the earliest recorded rate (baseline rate), matching PWA wage_service rules.
        """
        if self.wage_history:
            for entry in self.wage_history:
                if entry.effective_from <= target_date:
                    return Decimal(str(entry.daily_wage))
            # Fallback to earliest recorded rate as baseline
            return Decimal(str(self.wage_history[-1].daily_wage))
        return Decimal(str(self.daily_wage))
