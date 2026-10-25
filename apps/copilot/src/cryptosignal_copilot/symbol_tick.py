"""Binance PRICE_FILTER tick sizes (data-api.binance.vision) with in-process cache."""

from __future__ import annotations

import json
import logging
import math
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

_TICK_CACHE: dict[str, float] = {}
_FETCHED_ALL = False

_EXCHANGE_INFO_URL = "https://data-api.binance.vision/api/v3/exchangeInfo"


def _load_exchange_info() -> None:
    global _FETCHED_ALL
    if _FETCHED_ALL:
        return
    try:
        with urllib.request.urlopen(_EXCHANGE_INFO_URL, timeout=8) as resp:
            payload = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning("exchangeInfo fetch failed: %s", exc)
        _FETCHED_ALL = True
        return
    for row in payload.get("symbols") or []:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").upper()
        if not symbol:
            continue
        for filt in row.get("filters") or []:
            if isinstance(filt, dict) and filt.get("filterType") == "PRICE_FILTER":
                tick = float(filt.get("tickSize") or 0)
                if tick > 0:
                    _TICK_CACHE[symbol] = tick
                break
    _FETCHED_ALL = True


def _tick_from_magnitude(price: float) -> float:
    if price <= 0 or not math.isfinite(price):
        return 0.01
    magnitude = math.floor(math.log10(price))
    return 10 ** max(magnitude - 2, -8)


def tick_size_for_symbol(symbol: str, *, reference_price: float | None = None) -> float:
    key = symbol.replace("/", "").upper()
    _load_exchange_info()
    if key in _TICK_CACHE:
        return _TICK_CACHE[key]
    if reference_price is not None:
        return _tick_from_magnitude(reference_price)
    return 0.01
