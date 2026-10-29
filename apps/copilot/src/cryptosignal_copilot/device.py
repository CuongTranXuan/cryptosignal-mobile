"""Device ownership for sessions and chart history (docs/CHART_HISTORY_SPEC.md "Ownership").

Auth is the `csm_device` cookie only (never a header): `<device_id>.<hmac>`, httpOnly,
SameSite=Lax, Path=/, Secure in production. The HMAC key is `COPILOT_DEVICE_SECRET`
(required in production; outside production a per-machine dev secret is generated).

Any `/v1/copilot/*` request without a valid cookie gets a fresh device id, and the cookie
is set on its response. Store calls are scoped to that device, so another device's session
(or one hit without the cookie) is a plain 404.

`COPILOT_DEVICE_COOKIE_OPTIONAL=1` (dev only, off by default) serves cookie-less requests
*unscoped* (pre-ownership behaviour: every session) for a web proxy that does not forward
cookies yet.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import tempfile
from dataclasses import dataclass
from http.cookies import CookieError, SimpleCookie
from pathlib import Path

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from cryptosignal_copilot.config import is_production
from cryptosignal_copilot.env_parse import env_flag

logger = logging.getLogger(__name__)

DEVICE_COOKIE = "csm_device"
COOKIE_PATH = "/"
API_PREFIX = "/v1/copilot"
# Browsers cap cookie lifetime at 400 days.
COOKIE_MAX_AGE_S = 400 * 24 * 3600
MIN_SECRET_LEN = 32
_SIGN_CONTEXT = b"cs-device-v1:"
_DEV_SECRET_FILE = "cryptosignal-copilot-dev-device-secret"


class DeviceConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeviceSettings:
    secret: bytes
    cookie_optional: bool
    secure: bool


def _dev_secret() -> str:
    """Stable across restarts on this machine, so dev cookies survive a reload."""
    path = Path(tempfile.gettempdir()) / _DEV_SECRET_FILE
    try:
        existing = path.read_text().strip()
        if len(existing) >= MIN_SECRET_LEN:
            return existing
    except OSError:
        pass
    value = secrets.token_urlsafe(32)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(value)
    except OSError:
        logger.warning("device: could not persist the dev secret; cookies reset on restart")
    return value


def device_settings_from_env() -> DeviceSettings:
    prod = is_production()
    raw = os.environ.get("COPILOT_DEVICE_SECRET", "").strip()
    if not raw:
        if prod:
            raise DeviceConfigError("COPILOT_DEVICE_SECRET is required with COPILOT_ENV=production")
        raw = _dev_secret()
    elif len(raw) < MIN_SECRET_LEN:
        raise DeviceConfigError(f"COPILOT_DEVICE_SECRET must be at least {MIN_SECRET_LEN} chars")
    optional = env_flag("COPILOT_DEVICE_COOKIE_OPTIONAL")
    if optional and prod:
        raise DeviceConfigError("COPILOT_DEVICE_COOKIE_OPTIONAL is dev-only")
    secure = env_flag("COPILOT_DEVICE_COOKIE_SECURE", default=prod)
    return DeviceSettings(secret=raw.encode(), cookie_optional=optional, secure=secure)


def _sign(secret: bytes, device_id: str) -> str:
    mac = hmac.new(secret, _SIGN_CONTEXT + device_id.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode()


def issue_token(secret: bytes) -> tuple[str, str]:
    """(device_id, cookie value)."""
    device_id = secrets.token_urlsafe(16)
    return device_id, f"{device_id}.{_sign(secret, device_id)}"


def verify_token(secret: bytes, token: str | None) -> str | None:
    """The device id of a validly signed token, else None."""
    if not token or token.count(".") != 1:
        return None
    device_id, sig = token.split(".")
    if not device_id or not hmac.compare_digest(sig, _sign(secret, device_id)):
        return None
    return device_id


def _cookie_from_headers(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name != b"cookie":
            continue
        jar: SimpleCookie = SimpleCookie()
        try:
            jar.load(value.decode("latin-1"))
        except CookieError:
            continue
        morsel = jar.get(DEVICE_COOKIE)
        if morsel is not None:
            return morsel.value
    return None


def set_cookie_header(value: str, *, secure: bool) -> bytes:
    parts = [
        f"{DEVICE_COOKIE}={value}",
        f"Path={COOKIE_PATH}",
        f"Max-Age={COOKIE_MAX_AGE_S}",
        "HttpOnly",
        "SameSite=Lax",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts).encode("latin-1")


def request_owner(request_state: object) -> str | None:
    """The owner to scope store calls by: the device id, or None when unscoped."""
    return getattr(request_state, "device_id", None)


def verified_device(request_state: object) -> str | None:
    """The device id only when the request itself sent a valid cookie (not a fresh one)."""
    if not getattr(request_state, "device_verified", False):
        return None
    return request_owner(request_state)


class DeviceMiddleware:
    """Resolves the device for `/v1/copilot/*` and issues the cookie when it is missing."""

    def __init__(self, app: ASGIApp, settings: DeviceSettings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith(API_PREFIX):
            await self.app(scope, receive, send)
            return
        device_id = verify_token(self.settings.secret, _cookie_from_headers(scope))
        state = scope.setdefault("state", {})
        state["device_verified"] = device_id is not None
        new_cookie: bytes | None = None
        if device_id is None:
            issued_id, value = issue_token(self.settings.secret)
            new_cookie = set_cookie_header(value, secure=self.settings.secure)
            # Optional mode: serve this request unscoped; the cookie scopes the next one.
            device_id = None if self.settings.cookie_optional else issued_id
        state["device_id"] = device_id

        async def send_with_cookie(message: Message) -> None:
            if new_cookie is not None and message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"set-cookie", new_cookie))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cookie)
