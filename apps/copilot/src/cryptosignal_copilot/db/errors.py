"""Errors that mean "the database is unreachable or busy right now" (503, retryable).

Integrity and programming errors are bugs, not outages, and stay 500.
"""

from __future__ import annotations

from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

DB_UNAVAILABLE_ERRORS: tuple[type[Exception], ...] = (
    OperationalError,
    InterfaceError,
    PoolTimeoutError,
)
DB_RETRY_AFTER_S = 5
