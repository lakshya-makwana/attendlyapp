from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional, Tuple


class LoginRateLimiter:
    """
    Thread-safe in-memory rate limiter and brute-force protection for 4-digit MPIN login.
    Locks after max_attempts failed attempts for lockout_seconds.
    """

    def __init__(self, max_attempts: int = 5, lockout_seconds: int = 300):
        self.max_attempts = max_attempts
        self.lockout_seconds = lockout_seconds
        self._lock = Lock()
        self._attempts: dict[str, dict] = {}

    def is_locked(self, key: str = "default") -> Tuple[bool, int]:
        """
        Check if the key is currently locked out.
        Returns (is_locked, remaining_seconds).
        """
        with self._lock:
            record = self._attempts.get(key)
            if not record:
                return False, 0

            locked_until = record.get("locked_until")
            if locked_until:
                now = datetime.now(timezone.utc)
                if now < locked_until:
                    remaining = int((locked_until - now).total_seconds()) + 1
                    return True, remaining
                else:
                    # Lockout expired, reset record
                    del self._attempts[key]
                    return False, 0

            return False, 0

    def record_failure(self, key: str = "default") -> Tuple[bool, int]:
        """
        Record a failed attempt.
        Returns (is_now_locked, attempts_left_or_lockout_seconds).
        """
        with self._lock:
            now = datetime.now(timezone.utc)
            record = self._attempts.setdefault(key, {"failed_attempts": 0, "locked_until": None})
            record["failed_attempts"] += 1

            if record["failed_attempts"] >= self.max_attempts:
                record["locked_until"] = now + timedelta(seconds=self.lockout_seconds)
                return True, self.lockout_seconds

            attempts_left = self.max_attempts - record["failed_attempts"]
            return False, attempts_left

    def record_success(self, key: str = "default") -> None:
        """
        Clear failure count on successful login.
        """
        with self._lock:
            if key in self._attempts:
                del self._attempts[key]

    def reset(self) -> None:
        """
        Reset all attempt records (useful for test isolation).
        """
        with self._lock:
            self._attempts.clear()


login_rate_limiter = LoginRateLimiter()
