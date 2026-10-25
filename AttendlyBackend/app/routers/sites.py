from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.account import Account
from app.models.site import Site
from app.models.attendance import Attendance
from app.core.dependencies import get_current_account
from app.schemas.site import SiteCreate, SiteUpdate, SiteResponse

router = APIRouter(prefix="/sites", tags=["Sites"])


@router.get("", response_model=List[SiteResponse])
def list_sites(
    include_inactive: bool = Query(False, description="Whether to include deactivated sites"),
    active_only: bool = Query(False, description="Whether to only return active sites (PWA parameter parity)"),
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    List sites. Excludes deactivated sites by default unless include_inactive=True and active_only=False.
    """
    query = db.query(Site).filter((Site.account_id == current_account.id) | (Site.account_id.is_(None)))
    if active_only or not include_inactive:
        query = query.filter(Site.active.is_(True))
    return query.order_by(Site.name.asc()).all()


@router.post("", response_model=SiteResponse, status_code=status.HTTP_201_CREATED)
def create_site(
    site_in: SiteCreate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Create a new site. Validates that the site name is non-empty.
    """
    if site_in.id:
        existing = db.query(Site).filter(Site.id == site_in.id).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Site with ID '{site_in.id}' already exists",
            )

    site = Site(
        id=site_in.id if site_in.id else None,
        account_id=current_account.id,
        name=site_in.name,
        location=site_in.resolved_location(),
        active=site_in.active,
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return site


@router.get("/{site_id}", response_model=SiteResponse)
def get_site(
    site_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Retrieve details for a single site by ID.
    """
    site = db.query(Site).filter(Site.id == site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return site


@router.put("/{site_id}", response_model=SiteResponse)
@router.patch("/{site_id}", response_model=SiteResponse)
def update_site(
    site_id: str,
    site_in: SiteUpdate,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Update a site's name, location, or active status.
    Renaming a site preserves historical attendance integrity.
    """
    site = db.query(Site).filter(Site.id == site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    if site_in.name is not None:
        site.name = site_in.name

    if site_in.location is not None or site_in.address is not None:
        site.location = site_in.resolved_location()

    if site_in.active is not None:
        site.active = site_in.active

    db.commit()
    db.refresh(site)
    return site


@router.patch("/{site_id}/toggle-status", response_model=SiteResponse)
def toggle_site_status(
    site_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Toggle site active status (Active <-> Inactive), matching PWA behavior.
    Preserves all historical attendance records.
    """
    site = db.query(Site).filter(Site.id == site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    site.active = not site.active
    db.commit()
    db.refresh(site)
    return site


@router.delete("/{site_id}", status_code=status.HTTP_200_OK)
def delete_site(
    site_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Delete a site only if no historical attendance records reference it.
    If historical records exist, deletion is blocked with 400 Bad Request, matching PWA rules.
    """
    site = db.query(Site).filter(Site.id == site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    # Prevent deletion if historical attendance records exist
    attendance_count = db.query(Attendance).filter(Attendance.site_id == site_id).count()
    if attendance_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete '{site.name}' because it has {attendance_count} historical attendance records. Please deactivate the site instead.",
        )

    db.delete(site)
    db.commit()
    return {"message": f"Site '{site.name}' deleted successfully"}


@router.post("/{site_id}/deactivate", response_model=SiteResponse)
@router.put("/{site_id}/deactivate", response_model=SiteResponse)
def deactivate_site(
    site_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Deactivate a site. Deactivated sites are no longer available for new attendance entries,
    but all historical attendance records referencing this site are completely preserved.
    """
    site = db.query(Site).filter(Site.id == site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    site.active = False
    db.commit()
    db.refresh(site)
    return site


@router.post("/{site_id}/reactivate", response_model=SiteResponse)
@router.put("/{site_id}/reactivate", response_model=SiteResponse)
def reactivate_site(
    site_id: str,
    current_account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    Reactivate a previously deactivated site.
    """
    site = db.query(Site).filter(Site.id == site_id, (Site.account_id == current_account.id) | (Site.account_id.is_(None))).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    site.active = True
    db.commit()
    db.refresh(site)
    return site
