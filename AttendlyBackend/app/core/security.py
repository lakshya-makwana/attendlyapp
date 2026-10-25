from datetime import datetime, timedelta, timezone
from typing import Any, Optional
import bcrypt
import jwt
from app.config import settings


def hash_mpin(mpin: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(mpin.encode("utf-8"), salt).decode("utf-8")


def verify_mpin(plain_mpin: str, hashed_mpin: str) -> bool:
    try:
        return bcrypt.checkpw(plain_mpin.encode("utf-8"), hashed_mpin.encode("utf-8"))
    except Exception:
        return False


def create_access_token(subject: str | Any, expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {"sub": str(subject), "exp": expire}
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None
