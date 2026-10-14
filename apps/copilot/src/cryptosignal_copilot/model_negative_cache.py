from __future__ import annotations

import os
import time
from threading import Lock

_DEFAULT_TTL_S = 300.0


def load_negative_cache_ttl_s() -> float:
    raw = os.environ.get("COPILOT_MODEL_NEGATIVE_CACHE_TTL_S", "").strip()
    if not raw:
        return _DEFAULT_TTL_S
    try:
        return max(30.0, float(raw))
    except ValueError:
        return _DEFAULT_TTL_S


class ModelNegativeCache:
    def __init__(self, ttl_s: float | None = None) -> None:
        self._ttl_s = ttl_s if ttl_s is not None else load_negative_cache_ttl_s()
        self._lock = Lock()
        self._until: dict[str, float] = {}

    def clear(self) -> None:
        with self._lock:
            self._until.clear()

    def mark(self, model_id: str) -> None:
        if not model_id:
            return
        until = time.time() + self._ttl_s
        with self._lock:
            self._until[model_id] = until

    def is_blocked(self, model_id: str, *, now: float | None = None) -> bool:
        ts = now if now is not None else time.time()
        with self._lock:
            until = self._until.get(model_id)
            if until is None:
                return False
            if ts >= until:
                del self._until[model_id]
                return False
            return True

    def filter_ids(self, model_ids: list[str]) -> list[str]:
        ts = time.time()
        return [mid for mid in model_ids if not self.is_blocked(mid, now=ts)]


_default_cache = ModelNegativeCache()


def get_model_negative_cache() -> ModelNegativeCache:
    return _default_cache


def reset_model_negative_cache_for_tests(
    cache: ModelNegativeCache | None = None,
) -> ModelNegativeCache:
    global _default_cache
    _default_cache = cache if cache is not None else ModelNegativeCache(ttl_s=60.0)
    _default_cache.clear()
    return _default_cache
