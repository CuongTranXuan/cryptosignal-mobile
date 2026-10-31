"""Admin token for operator-only routes (today: the full feedback export).

`COPILOT_ADMIN_TOKEN`, sent as `Authorization: Bearer <token>`. Unset = admin routes are
disabled. In production the token must be at least 32 characters or the app refuses to
start. The token is never logged or echoed.
"""

from __future__ import annotations

import hmac
import os

from cryptosignal_copilot.config import is_production

MIN_PRODUCTION_TOKEN_LEN = 32


class AdminConfigError(RuntimeError):
    pass


def admin_token_from_env() -> str | None:
    token = os.environ.get("COPILOT_ADMIN_TOKEN", "").strip()
    if not token:
        return None
    if is_production() and len(token) < MIN_PRODUCTION_TOKEN_LEN:
        raise AdminConfigError(
            f"COPILOT_ADMIN_TOKEN must be at least {MIN_PRODUCTION_TOKEN_LEN} characters"
            " with COPILOT_ENV=production"
        )
    return token


def check_admin(authorization: str, token: str | None) -> str | None:
    """None when `authorization` carries the admin token, else the error code."""
    if token is None:
        return "admin_export_disabled"
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(
        value.strip().encode(), token.encode()
    ):
        return "admin_forbidden"
    return None
