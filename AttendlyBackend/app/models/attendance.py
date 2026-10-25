from sqlalchemy import Column, String, Numeric, Date, DateTime, ForeignKey, UniqueConstraint, Index, CheckConstraint
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.common import generate_uuid, utc_now


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    worker_id = Column(String(36), ForeignKey("workers.id", ondelete="CASCADE"), nullable=False, index=True)
    site_id = Column(String(36), ForeignKey("sites.id", ondelete="RESTRICT"), nullable=True, index=True)
    date = Column(Date, nullable=False, index=True)
    work_units = Column(Numeric(3, 1), nullable=False, default=1.0)
    notes = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    account = relationship("Account")
    worker = relationship("Worker", back_populates="attendance")
    site = relationship("Site", back_populates="attendance")

    __table_args__ = (
        UniqueConstraint("worker_id", "date", name="uq_attendance_worker_date"),
        Index("ix_attendance_worker_date", "worker_id", "date"),
        CheckConstraint("work_units IN (0, 0.5, 1, 1.5, 2)", name="ck_attendance_work_units"),
    )
