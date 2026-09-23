"""Simple in-memory per-IP rate limit for single-instance deploys (e.g. Render free)."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from threading import Lock


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


def client_ip(headers: dict[str, str], fallback: str | None) -> str:
    """Prefer first X-Forwarded-For hop (Render); else peer host."""
    xff = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return fallback or "unknown"
