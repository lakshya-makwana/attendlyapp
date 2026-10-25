from datetime import date
from decimal import Decimal
from typing import Dict, List, Tuple, Optional, Iterable
from sqlalchemy.orm import Session
from app.models.worker import Worker
from app.models.worker_wage_history import WorkerWageHistory


def resolve_effective_wage_from_list(
    wages: List[Tuple[date, Decimal]],
    target_date: date,
    fallback_wage: Decimal = Decimal("0.00"),
) -> Decimal:
    """
    Finds the daily wage effective on `target_date`.
    Assumes `wages` is a list of (effective_from, daily_wage) sorted by effective_from ASC.
    - If target_date is on or after a wage's effective_from, that wage applies until a newer rate takes effect.
    - If target_date is before the earliest recorded effective_from, falls back to the earliest recorded
      wage (baseline fallback), matching PWA wage_service resolve_effective_wage.
    """
    if not wages:
        return fallback_wage

    applicable_wage = wages[0][1]  # Earliest available as baseline fallback
    for eff_date, rate in wages:
        if eff_date <= target_date:
            applicable_wage = rate
        else:
            break
    return applicable_wage


def get_worker_wages_map(
    db: Session,
    worker_ids: Optional[Iterable[str]] = None,
) -> Dict[str, List[Tuple[date, Decimal]]]:
    """
    Fetches all wage history records for given worker IDs (or all workers)
    in a single query to eliminate N+1 overhead.
    Returns: {worker_id: [(effective_from, daily_wage), ...]} sorted by effective_from ASC.
    """
    query = db.query(WorkerWageHistory)
    if worker_ids is not None:
        query = query.filter(WorkerWageHistory.worker_id.in_(list(worker_ids)))

    records = query.order_by(
        WorkerWageHistory.worker_id.asc(),
        WorkerWageHistory.effective_from.asc(),
        WorkerWageHistory.id.asc(),
    ).all()

    wages_map: Dict[str, List[Tuple[date, Decimal]]] = {}
    for r in records:
        wages_map.setdefault(r.worker_id, []).append((r.effective_from, Decimal(str(r.daily_wage))))

    return wages_map


def compute_wage_breakdown(
    attendances: list,
    wages: List[Tuple[date, Decimal]],
    default_wage: Decimal = Decimal("0.00"),
) -> List[dict]:
    """
    Computes separate wage-rate breakdowns for a worker's attendances in a period.
    Returns a list of dictionaries: [{"rate": Decimal, "work_units": Decimal, "earnings": Decimal}]
    ordered by rate or date sequence.
    """
    breakdown_map: Dict[Decimal, dict] = {}
    rate_order: List[Decimal] = []

    for att in attendances:
        units = Decimal(str(att.work_units))
        rate = resolve_effective_wage_from_list(wages, att.date, default_wage)
        if rate not in breakdown_map:
            breakdown_map[rate] = {
                "rate": rate,
                "work_units": Decimal("0.0"),
                "earnings": Decimal("0.00"),
            }
            rate_order.append(rate)

        breakdown_map[rate]["work_units"] += units
        breakdown_map[rate]["earnings"] += (units * rate).quantize(Decimal("0.01"))

    return [breakdown_map[r] for r in rate_order]


def resolve_effective_wage(db: Session, worker_id: str, target_date: date) -> Optional[Decimal]:
    """
    Single-record lookup for backward compatibility.
    """
    record = (
        db.query(WorkerWageHistory)
        .filter(
            WorkerWageHistory.worker_id == worker_id,
            WorkerWageHistory.effective_from <= target_date,
        )
        .order_by(WorkerWageHistory.effective_from.desc())
        .first()
    )
    if record:
        return Decimal(str(record.daily_wage)).quantize(Decimal("0.01"))

    has_any_history = (
        db.query(WorkerWageHistory)
        .filter(WorkerWageHistory.worker_id == worker_id)
        .first()
    )
    if not has_any_history:
        worker = db.query(Worker).filter(Worker.id == worker_id).first()
        if worker and worker.daily_wage is not None:
            return Decimal(str(worker.daily_wage)).quantize(Decimal("0.01"))

    return None


def calculate_daily_earnings(work_units: Decimal, effective_wage: Decimal) -> Decimal:
    """
    Calculate daily earnings using decimal-safe arithmetic:
    daily_earnings = work_units * effective_daily_wage
    """
    return (Decimal(str(work_units)) * Decimal(str(effective_wage))).quantize(Decimal("0.01"))
