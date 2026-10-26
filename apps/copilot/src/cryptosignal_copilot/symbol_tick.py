"""Binance tick/step sizes: slim on-disk cache + per-symbol background refresh.

Lookups never touch the network. `tick_size_for_symbol` answers from the in-process
cache (loaded from a small JSON file at startup, stale entries included) or from a
price-magnitude fallback, and schedules an async `exchangeInfo?symbol=X` fetch
(data-api.binance.vision, a few KB instead of the 17.8 MB full list) when the entry
is missing or older than the TTL. Fetched entries are written back to disk off the
event loop. Failures back off exponentially and are retried later.

File: `COPILOT_TICK_CACHE_PATH`, else `$COPILOT_DATA_DIR/symbol_ticks.json`, else
`apps/copilot/data/symbol_ticks.json` (gitignored). Holds only
`{symbol: {tick_size, step_size, fetched_at}}`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

EXCHANGE_INFO_URL = "https://data-api.binance.vision/api/v3/exchangeInfo"
_FETCH_TIMEOUT_S = 5.0
_DEFAULT_TTL_S = 24 * 3600.0
_BACKOFF_BASE_S = 30.0
_BACKOFF_MAX_S = 3600.0
_FILE_VERSION = 1


@dataclass
class _Entry:
    tick: float | None = None
    step: float | None = None
    fetched_at: float = 0.0  # wall clock (persisted)
    failures: int = 0
    retry_at: float = 0.0


class TickSizeCache:
    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        enabled: bool = True,
        path: Path | None = None,
        ttl_s: float = _DEFAULT_TTL_S,
    ) -> None:
        self._transport = transport
        self._clock = clock
        self.enabled = enabled
        self.path = path
        self.ttl_s = ttl_s
        self._entries: dict[str, _Entry] = {}
        self._tasks: dict[str, asyncio.Task[float | None]] = {}
        self._loaded = False

    # ------------------------------------------------------------------ disk

    def load(self) -> int:
        """Read the persisted cache once (small file; safe at startup). Returns entry count."""
        if self._loaded:
            return len(self._entries)
        self._loaded = True
        if self.path is None or not self.path.is_file():
            return 0
        try:
            payload = json.loads(self.path.read_text())
            rows = payload.get("symbols") if payload.get("version") == _FILE_VERSION else None
            for key, row in (rows or {}).items():
                tick = float(row.get("tick_size") or 0)
                if tick > 0:
                    step = float(row.get("step_size") or 0) or None
                    self._entries[key] = _Entry(tick, step, float(row.get("fetched_at") or 0))
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            logger.warning("tick cache %s unreadable (%s); starting empty", self.path, exc)
        return len(self._entries)

    def _snapshot(self) -> dict[str, object]:
        return {
            "version": _FILE_VERSION,
            "symbols": {
                key: {"tick_size": e.tick, "step_size": e.step, "fetched_at": round(e.fetched_at)}
                for key, e in sorted(self._entries.items())
                if e.tick is not None
            },
        }

    def _write(self, snapshot: dict[str, object]) -> None:
        assert self.path is not None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(snapshot, separators=(",", ":")))
            os.replace(tmp, self.path)
        except OSError as exc:
            logger.warning("tick cache write failed (%s)", exc)

    # ------------------------------------------------------------------ lookups

    def cached(self, symbol: str) -> float | None:
        if not self._loaded:
            self.load()
        entry = self._entries.get(_key(symbol))
        return entry.tick if entry is not None else None

    def cached_step(self, symbol: str) -> float | None:
        entry = self._entries.get(_key(symbol))
        return entry.step if entry is not None else None

    def set(self, symbol: str, tick: float, step: float | None = None) -> None:
        self._entries[_key(symbol)] = _Entry(tick=tick, step=step, fetched_at=self._clock())

    def clear(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()
        self._entries.clear()

    def _due(self, key: str) -> bool:
        if not self.enabled or not key or key in self._tasks:
            return False
        entry = self._entries.get(key)
        now = self._clock()
        if entry is None:
            return True
        if now < entry.retry_at:
            return False
        return entry.tick is None or now - entry.fetched_at >= self.ttl_s

    def schedule(self, symbol: str) -> asyncio.Task[float | None] | None:
        """Start a background fetch if due; no-op without a running loop."""
        key = _key(symbol)
        if not self._due(key):
            return self._tasks.get(key)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return None
        task = loop.create_task(self._fetch(key))
        self._tasks[key] = task
        task.add_done_callback(partial(self._forget_task, key))
        return task

    def _forget_task(self, key: str, _task: asyncio.Task[float | None]) -> None:
        self._tasks.pop(key, None)

    async def _fetch(self, key: str) -> float | None:
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=_FETCH_TIMEOUT_S
            ) as client:
                res = await client.get(EXCHANGE_INFO_URL, params={"symbol": key})
                res.raise_for_status()
                tick, step = _parse_filters(res.json(), key)
        except (httpx.HTTPError, ValueError) as exc:
            self._record_failure(key, type(exc).__name__)
            return None
        if tick is None:
            self._record_failure(key, "no PRICE_FILTER")
            return None
        self._entries[key] = _Entry(tick=tick, step=step, fetched_at=self._clock())
        if self.path is not None:
            await asyncio.to_thread(self._write, self._snapshot())
        return tick

    def _record_failure(self, key: str, reason: str) -> None:
        # Keep a stale tick (served meanwhile); only the retry time moves.
        entry = self._entries.setdefault(key, _Entry())
        entry.failures += 1
        delay = min(_BACKOFF_MAX_S, _BACKOFF_BASE_S * 2 ** (entry.failures - 1))
        entry.retry_at = self._clock() + delay
        logger.warning(
            "exchangeInfo %s failed (%s); retry in %.0fs (attempt %d)",
            key,
            reason,
            delay,
            entry.failures,
        )


def _key(symbol: str) -> str:
    return symbol.replace("/", "").strip().upper()


def _parse_filters(payload: object, key: str) -> tuple[float | None, float | None]:
    if not isinstance(payload, dict):
        return None, None
    for row in payload.get("symbols") or []:
        if not isinstance(row, dict) or str(row.get("symbol") or "").upper() != key:
            continue
        sizes: dict[str, float] = {}
        for filt in row.get("filters") or []:
            if not isinstance(filt, dict):
                continue
            if filt.get("filterType") == "PRICE_FILTER":
                sizes["tick"] = float(filt.get("tickSize") or 0)
            elif filt.get("filterType") == "LOT_SIZE":
                sizes["step"] = float(filt.get("stepSize") or 0)
        tick = sizes.get("tick", 0.0)
        step = sizes.get("step", 0.0)
        return (tick if tick > 0 else None), (step if step > 0 else None)
    return None, None


def tick_from_magnitude(price: float) -> float:
    """Approximate Binance USDT ticks: ~5 significant digits, capped at 0.01, floor 1e-8.

    BTC/ETH/SOL → 0.01, DOGE 0.12 → 1e-5, PEPE/SHIB → 1e-8.
    """
    if price <= 0 or not math.isfinite(price):
        return 0.01
    magnitude = math.floor(math.log10(price))
    return min(0.01, 10.0 ** max(magnitude - 4, -8))


def default_cache_path() -> Path:
    explicit = os.environ.get("COPILOT_TICK_CACHE_PATH", "").strip()
    if explicit:
        return Path(explicit).expanduser()
    data_dir = os.environ.get("COPILOT_DATA_DIR", "").strip()
    if data_dir:
        return Path(data_dir).expanduser() / "symbol_ticks.json"
    return Path(__file__).resolve().parents[2] / "data" / "symbol_ticks.json"


def _env_enabled() -> bool:
    raw = os.environ.get("COPILOT_TICK_FETCH", "").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _env_ttl() -> float:
    try:
        return max(60.0, float(os.environ.get("COPILOT_TICK_CACHE_TTL_S", _DEFAULT_TTL_S)))
    except ValueError:
        return _DEFAULT_TTL_S


_cache = TickSizeCache(enabled=_env_enabled(), path=default_cache_path(), ttl_s=_env_ttl())


def get_tick_cache() -> TickSizeCache:
    return _cache


def set_tick_cache_for_tests(cache: TickSizeCache) -> TickSizeCache:
    global _cache
    _cache = cache
    return cache


def prefetch_tick_size(symbol: str) -> None:
    """Warm the cache off the request path (call from async handlers)."""
    _cache.schedule(symbol)


def tick_size_for_symbol(symbol: str, *, reference_price: float | None = None) -> float:
    """Never blocks: cached exchange tick (even stale), else magnitude fallback."""
    tick = _cache.cached(symbol)
    _cache.schedule(symbol)  # no-op unless missing / past TTL / retry due
    if tick is not None:
        return tick
    if reference_price is not None:
        return tick_from_magnitude(reference_price)
    return 0.01
