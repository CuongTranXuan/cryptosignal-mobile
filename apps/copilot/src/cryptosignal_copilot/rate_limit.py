"""In-memory per-IP rate limit for a single-process deploy (one uvicorn worker)."""

from __future__ import annotations

import ipaddress
import logging
import os
import time
from collections import defaultdict, deque
from functools import lru_cache
from threading import Lock

logger = logging.getLogger(__name__)

IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


def _limit_per_minute() -> int:
    raw = os.environ.get("RATE_LIMIT_PER_MINUTE", "10").strip()
    try:
        value = int(raw)
    except ValueError:
        return 10
    return max(1, value)


class SlidingWindowRateLimiter:
    """Fixed-window-ish sliding counter: allow `limit` hits per rolling 60s per key."""

    def __init__(self, limit: int | None = None, window_s: float = 60.0) -> None:
        self.limit = limit if limit is not None else _limit_per_minute()
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_s
        with self._lock:
            q = self._hits[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


@lru_cache(maxsize=8)
def _parse_trusted(raw: str) -> tuple[IpNetwork, ...]:
    nets: list[IpNetwork] = []
    for item in (part.strip() for part in raw.split(",")):
        if not item:
            continue
        try:
            nets.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            logger.warning("ignoring invalid COPILOT_TRUSTED_PROXIES entry %r", item)
    return tuple(nets)


def trusted_proxies() -> tuple[IpNetwork, ...]:
    """`COPILOT_TRUSTED_PROXIES`: comma-separated IPs/CIDRs of reverse proxies (e.g. 127.0.0.1)."""
    return _parse_trusted(os.environ.get("COPILOT_TRUSTED_PROXIES", ""))


def _ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value.strip())
    except ValueError:
        return None


def _is_trusted(addr: ipaddress.IPv4Address | ipaddress.IPv6Address | None, nets) -> bool:
    return addr is not None and any(addr in net for net in nets)


def client_ip(headers: dict[str, str], peer: str | None) -> str:
    """Rate-limit key. `X-Forwarded-For` counts only when the TCP peer is a trusted proxy;
    then the rightmost hop that is not itself a trusted proxy is the client (hops left
    of it can be forged by the client)."""
    fallback = peer or "unknown"
    nets = trusted_proxies()
    if not nets or not _is_trusted(_ip(peer or ""), nets):
        return fallback
    xff = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For") or ""
    for hop in reversed([h.strip() for h in xff.split(",") if h.strip()]):
        addr = _ip(hop)
        if addr is None:
            return fallback
        if not _is_trusted(addr, nets):
            return str(addr)
    return fallback
