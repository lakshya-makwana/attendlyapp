from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import desc, extract
from app.database import get_db
from app.models.account import Account
from app.models.advance import Advance
from app.models.worker import Worker
from app.core.dependencies import get_current_account
from app.schemas.advance import AdvanceCreate, AdvanceUpdate, AdvanceResponse

router = APIRouter(prefix="/advances", tags=["Advances"])


def build_advance_response(a: Advance) -> AdvanceResponse:
    return AdvanceResponse(
        id=a.id,
        worker_id=a.worker_id,
        worker_name=a.worker.name if a.worker else "Unknown",
        account_id=a.account_id,
        amount=a.amount,
        date=a.date,
        note=a.note,
        created_at=a.created_at,
        updated_at=a.updated_at,
    )


@router.get("", response_model=List[AdvanceResponse])
def get_advances(
    worker_id: Optional[str] = Query(None, description="Filter by worker ID"),
    start_date: Optional[date] = Query(None, description="Start date (inclusive)"),
    end_date: Optional[date] = Query(None, description="End date (inclusive)"),
    year: Optional[int] = Query(None, description="Filter by calendar year"),
    month: Optional[int] = Query(None, description="Filter by calendar month (1-12)"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve advances with optional worker and date range filtering.
    """
    query = db.query(Advance).options(selectinload(Advance.worker))

    if current_account.id:
        # If advances have account_id populated, filter by it or allow all in dedicated instance
        query = query.filter((Advance.account_id == current_account.id) | (Advance.account_id.is_(None)))

    if worker_id:
        worker = db.query(Worker).filter(Worker.id == worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
        if not worker:
            return []
        query = query.filter(Advance.worker_id == worker_id)

    if start_date:
        query = query.filter(Advance.date >= start_date)
    if end_date:
        query = query.filter(Advance.date <= end_date)
    if year:
        query = query.filter(extract("year", Advance.date) == year)
    if month:
        query = query.filter(extract("month", Advance.date) == month)

    advances = query.order_by(desc(Advance.date), desc(Advance.created_at)).all()
    return [build_advance_response(a) for a in advances]


@router.get("/{advance_id}", response_model=AdvanceResponse)
def get_advance(
    advance_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve a single advance transaction by ID.
    """
    advance = (
        db.query(Advance)
        .options(selectinload(Advance.worker))
        .filter(
            Advance.id == advance_id,
            (Advance.account_id == current_account.id) | (Advance.account_id.is_(None)),
        )
        .first()
    )
    if not advance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Advance transaction not found",
        )
    return build_advance_response(advance)


@router.post("", response_model=AdvanceResponse, status_code=status.HTTP_201_CREATED)
def record_advance(
    adv_in: AdvanceCreate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Record a new cash advance for a worker.
    Validates that the worker exists and that amount is positive.
    Idempotently handles existing ID for offline synchronization.
    """
    worker = db.query(Worker).filter(Worker.id == adv_in.worker_id, (Worker.account_id == current_account.id) | (Worker.account_id.is_(None))).first()
    if not worker:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Worker not found",
        )

    # Check for existing advance by client ID (idempotent write for sync retries)
    if adv_in.id:
        existing = db.query(Advance).filter(
            Advance.id == adv_in.id,
            (Advance.account_id == current_account.id) | (Advance.account_id.is_(None)),
        ).first()
        if existing:
            existing.worker_id = adv_in.worker_id
            existing.amount = adv_in.amount
            existing.date = adv_in.date
            existing.note = adv_in.note
            existing.account_id = current_account.id
            db.commit()
            db.refresh(existing)
            return build_advance_response(existing)

    advance = Advance(
        id=adv_in.id if adv_in.id else None,
        account_id=current_account.id,
        worker_id=adv_in.worker_id,
        amount=adv_in.amount,
        date=adv_in.date,
        note=adv_in.note,
    )
    db.add(advance)
    db.commit()
    db.refresh(advance)
    return build_advance_response(advance)


@router.put("/{advance_id}", response_model=AdvanceResponse)
@router.patch("/{advance_id}", response_model=AdvanceResponse)
def update_advance(
    advance_id: str,
    adv_in: AdvanceUpdate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Update an advance entry amount, date, or note.
    """
    advance = (
        db.query(Advance)
        .options(selectinload(Advance.worker))
        .filter(
            Advance.id == advance_id,
            (Advance.account_id == current_account.id) | (Advance.account_id.is_(None)),
        )
        .first()
    )
    if not advance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Advance transaction not found",
        )

    if adv_in.amount is not None:
        advance.amount = adv_in.amount
    if adv_in.date is not None:
        advance.date = adv_in.date
    if adv_in.note is not None:
        advance.note = adv_in.note

    db.commit()
    db.refresh(advance)
    return build_advance_response(advance)


@router.delete("/{advance_id}", status_code=status.HTTP_200_OK)
def delete_advance(
    advance_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Delete an advance entry. This removes the advance deduction from payroll.
    """
    advance = db.query(Advance).filter(
        Advance.id == advance_id,
        (Advance.account_id == current_account.id) | (Advance.account_id.is_(None)),
    ).first()
    if not advance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Advance transaction not found",
        )

    db.delete(advance)
    db.commit()
    return {"message": "Advance record deleted successfully"}
