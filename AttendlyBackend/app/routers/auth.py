from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models.account import Account
from app.core.security import hash_mpin, verify_mpin, create_access_token
from app.core.dependencies import get_current_account
from app.core.rate_limit import login_rate_limiter
from app.schemas.auth import (
    AccountSetupRequest,
    AccountLoginRequest,
    AccountResponse,
    AuthResponse,
    AuthStatusResponse,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/status", response_model=AuthStatusResponse)
def get_auth_status(db: Session = Depends(get_db)):
    """
    Check whether initial account setup has already been completed on this installation.
    Allows returning users to skip directly to the 4-digit MPIN login screen.
    """
    account_exists = db.query(Account).first() is not None
    return AuthStatusResponse(
        is_setup=account_exists,
        message="Account is ready for MPIN login" if account_exists else "Initial account setup required",
    )


@router.post("/setup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def setup_account(request: AccountSetupRequest, db: Session = Depends(get_db)):
    """
    First-time account setup: Phone number + 4-digit MPIN + Confirm MPIN.
    Strictly enforces one contractor/admin account only.
    """
    # Enforce single account rule
    existing_account = db.query(Account).first()
    if existing_account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account has already been created for this installation. Only one account is permitted.",
        )

    # Securely hash MPIN with bcrypt
    hashed = hash_mpin(request.mpin)

    account = Account(
        phone_number=request.phone_number,
        mpin_hash=hashed,
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    # Issue signed JWT
    access_token = create_access_token(subject=account.id)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return AuthResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in,
        account=AccountResponse.model_validate(account),
    )


@router.post("/login", response_model=AuthResponse)
@router.post("/login-mpin", response_model=AuthResponse)
def login_mpin(
    login_request: AccountLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Returning login: 4-digit MPIN only for recognized installation.
    Includes brute-force rate-limiting and failed attempt lockout.
    """
    client_ip = request.client.host if request.client else "unknown"

    # Check brute-force lockout
    is_locked, remaining_seconds = login_rate_limiter.is_locked(client_ip)
    if is_locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Temporarily locked out. Please try again in {remaining_seconds} seconds.",
            headers={"Retry-After": str(remaining_seconds)},
        )

    # Retrieve single account
    account = db.query(Account).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No account exists. Please complete account setup first.",
        )

    # Verify MPIN
    if not verify_mpin(login_request.mpin, account.mpin_hash):
        is_now_locked, attempts_or_seconds = login_rate_limiter.record_failure(client_ip)
        if is_now_locked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed login attempts. Temporarily locked out for {attempts_or_seconds} seconds.",
                headers={"Retry-After": str(attempts_or_seconds)},
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials. Authentication failed.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Clear rate limiter on success
    login_rate_limiter.record_success(client_ip)

    # Issue signed JWT
    access_token = create_access_token(subject=account.id)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return AuthResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in,
        account=AccountResponse.model_validate(account),
    )


@router.get("/me", response_model=AccountResponse)
def get_me(current_account: Account = Depends(get_current_account)):
    """
    Protected endpoint: returns the authenticated contractor's account details.
    Never exposes MPIN or hash.
    """
    return AccountResponse.model_validate(current_account)
