import datetime
from decimal import Decimal
import pytest
from sqlalchemy.exc import IntegrityError
from app.models import Account, Worker, WorkerWageHistory, Site, Attendance


def test_account_model(db):
    account = Account(
        phone_number="9876543210",
        mpin_hash="hashed_mpin_value_123456",
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    assert account.id is not None
    assert account.phone_number == "9876543210"
    assert account.mpin_hash == "hashed_mpin_value_123456"
    assert account.created_at is not None
    assert account.updated_at is not None


def test_worker_model(db):
    worker = Worker(
        name="Ramesh Kumar",
        daily_wage=Decimal("600.00"),
        active=True,
    )
    db.add(worker)
    db.commit()
    db.refresh(worker)

    assert worker.id is not None
    assert worker.name == "Ramesh Kumar"
    assert worker.daily_wage == Decimal("600.00")
    assert worker.active is True
    assert worker.created_at is not None
    assert worker.updated_at is not None


def test_site_model(db):
    site = Site(
        name="Metro Tower Phase 2",
        active=True,
    )
    db.add(site)
    db.commit()
    db.refresh(site)

    assert site.id is not None
    assert site.name == "Metro Tower Phase 2"
    assert site.active is True
    assert site.created_at is not None
    assert site.updated_at is not None


def test_per_worker_site_assignment_on_same_date(db):
    """
    Verifies that two different workers can have different site assignments
    on the exact same date.
    """
    site_metro = Site(name="Metro Tower Phase 2", active=True)
    site_sunrise = Site(name="Sunrise Villa 14", active=True)
    worker_ramesh = Worker(name="Ramesh Kumar", daily_wage=Decimal("600.00"), active=True)
    worker_suresh = Worker(name="Suresh Patel", daily_wage=Decimal("750.00"), active=True)

    db.add_all([site_metro, site_sunrise, worker_ramesh, worker_suresh])
    db.commit()

    date_today = datetime.date(2026, 10, 24)

    # Ramesh -> Metro Tower Phase 2 -> 1 work unit
    att_ramesh = Attendance(
        worker_id=worker_ramesh.id,
        site_id=site_metro.id,
        date=date_today,
        work_units=Decimal("1.0"),
    )
    # Suresh -> Sunrise Villa 14 -> 1.5 work units
    att_suresh = Attendance(
        worker_id=worker_suresh.id,
        site_id=site_sunrise.id,
        date=date_today,
        work_units=Decimal("1.5"),
    )

    db.add_all([att_ramesh, att_suresh])
    db.commit()

    db.refresh(att_ramesh)
    db.refresh(att_suresh)

    assert att_ramesh.worker.name == "Ramesh Kumar"
    assert att_ramesh.site.name == "Metro Tower Phase 2"
    assert att_ramesh.work_units == Decimal("1.0")

    assert att_suresh.worker.name == "Suresh Patel"
    assert att_suresh.site.name == "Sunrise Villa 14"
    assert att_suresh.work_units == Decimal("1.5")

    assert att_ramesh.site_id != att_suresh.site_id
    assert att_ramesh.date == att_suresh.date


def test_worker_date_uniqueness_constraint(db):
    """
    Verifies that a duplicate attendance record for the same worker + date is blocked.
    """
    site = Site(name="Site Alpha", active=True)
    worker = Worker(name="Test Worker", daily_wage=Decimal("500.00"), active=True)
    db.add_all([site, worker])
    db.commit()

    date_today = datetime.date(2026, 10, 24)

    att1 = Attendance(
        worker_id=worker.id,
        site_id=site.id,
        date=date_today,
        work_units=Decimal("1.0"),
    )
    db.add(att1)
    db.commit()

    duplicate_att = Attendance(
        worker_id=worker.id,
        site_id=site.id,
        date=date_today,
        work_units=Decimal("0.5"),
    )
    db.add(duplicate_att)
    with pytest.raises(IntegrityError):
        db.commit()

    db.rollback()


def test_work_units_values(db):
    """
    Verifies work_units values: 0 (Absent), 0.5 (Half), 1 (Full), 1.5 (OT), 2 (Double).
    """
    site = Site(name="Site Beta", active=True)
    worker = Worker(name="Units Worker", daily_wage=Decimal("500.00"), active=True)
    db.add_all([site, worker])
    db.commit()

    values = [Decimal("0"), Decimal("0.5"), Decimal("1.0"), Decimal("1.5"), Decimal("2.0")]
    for idx, val in enumerate(values):
        att = Attendance(
            worker_id=worker.id,
            site_id=site.id,
            date=datetime.date(2026, 10, 1 + idx),
            work_units=val,
        )
        db.add(att)
    db.commit()

    records = db.query(Attendance).filter(Attendance.worker_id == worker.id).order_by(Attendance.date.asc()).all()
    assert len(records) == 5
    assert [r.work_units for r in records] == values


def test_invalid_work_units_rejected(db):
    """
    Verifies that invalid work_units values (e.g. 0.75, 3.0, -1.0) violate the CheckConstraint.
    """
    site = Site(name="Site Constraint Test", active=True)
    worker = Worker(name="Constraint Worker", daily_wage=Decimal("500.00"), active=True)
    db.add_all([site, worker])
    db.commit()

    att = Attendance(
        worker_id=worker.id,
        site_id=site.id,
        date=datetime.date(2026, 10, 24),
        work_units=Decimal("0.75"),  # Invalid work unit
    )
    db.add(att)
    with pytest.raises(IntegrityError):
        db.commit()

    db.rollback()


def test_attendance_date_is_date_only(db):
    """
    Verifies attendance date is stored as a calendar date, not a shifted timestamp.
    """
    site = Site(name="Site Gamma", active=True)
    worker = Worker(name="Date Worker", daily_wage=Decimal("550.00"), active=True)
    db.add_all([site, worker])
    db.commit()

    calendar_date = datetime.date(2026, 10, 15)
    att = Attendance(
        worker_id=worker.id,
        site_id=site.id,
        date=calendar_date,
        work_units=Decimal("1.0"),
    )
    db.add(att)
    db.commit()
    db.refresh(att)

    assert isinstance(att.date, datetime.date)
    assert not isinstance(att.date, datetime.datetime)
    assert att.date == calendar_date


def test_worker_wage_history_and_effective_dated_resolution(db):
    """
    Verifies:
    1. A worker can have multiple wage-history entries.
    2. Resolves the wage using the latest effective_from date on or before the attendance date.
    3. A wage change effective on 11 October does not alter earnings for attendance on 10 October.
    """
    worker = Worker(name="Vikas Sharma", daily_wage=Decimal("500.00"), active=True)
    site = Site(name="Tower A", active=True)
    db.add_all([worker, site])
    db.commit()

    # Initial wage effective Oct 1: 500
    wage_entry_1 = WorkerWageHistory(
        worker_id=worker.id,
        daily_wage=Decimal("500.00"),
        effective_from=datetime.date(2026, 10, 1),
    )
    # Increased wage effective Oct 11: 600
    wage_entry_2 = WorkerWageHistory(
        worker_id=worker.id,
        daily_wage=Decimal("600.00"),
        effective_from=datetime.date(2026, 10, 11),
    )
    db.add_all([wage_entry_1, wage_entry_2])
    db.commit()

    # Refresh worker with relationships
    db.refresh(worker)

    # 10 October attendance (should resolve to 500)
    oct_10 = datetime.date(2026, 10, 10)
    wage_oct_10 = worker.get_effective_wage(oct_10)
    assert wage_oct_10 == Decimal("500.00")

    # 11 October attendance (effective date, should resolve to 600)
    oct_11 = datetime.date(2026, 10, 11)
    wage_oct_11 = worker.get_effective_wage(oct_11)
    assert wage_oct_11 == Decimal("600.00")

    # 20 October attendance (later date, should resolve to 600)
    oct_20 = datetime.date(2026, 10, 20)
    wage_oct_20 = worker.get_effective_wage(oct_20)
    assert wage_oct_20 == Decimal("600.00")

    # Calculate simulated earnings without mutating historical attendance
    earnings_oct_10 = Decimal("1.0") * wage_oct_10
    earnings_oct_11 = Decimal("1.0") * wage_oct_11
    assert earnings_oct_10 == Decimal("500.00")
    assert earnings_oct_11 == Decimal("600.00")


def test_duplicate_wage_history_for_same_worker_and_date_blocked(db):
    """
    Verifies that duplicate wage-history entries for the same worker and effective date are blocked.
    """
    worker = Worker(name="Amit Patel", daily_wage=Decimal("450.00"), active=True)
    db.add(worker)
    db.commit()

    effective_date = datetime.date(2026, 10, 1)
    entry_1 = WorkerWageHistory(
        worker_id=worker.id,
        daily_wage=Decimal("450.00"),
        effective_from=effective_date,
    )
    db.add(entry_1)
    db.commit()

    duplicate_entry = WorkerWageHistory(
        worker_id=worker.id,
        daily_wage=Decimal("500.00"),
        effective_from=effective_date,
    )
    db.add(duplicate_entry)
    with pytest.raises(IntegrityError):
        db.commit()

    db.rollback()


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "Attendly Mobile API"
