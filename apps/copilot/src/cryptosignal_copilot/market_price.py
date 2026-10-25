"""Chart-aligned price formatting (mirrors apps/web/lib/format-market-price.ts)."""

from __future__ import annotations

_TICK_SIZE_BY_SYMBOL: dict[str, float] = {
    "BTCUSDT": 0.01,
    "ETHUSDT": 0.01,
    "BNBUSDT": 0.01,
    "SOLUSDT": 0.01,
    "XRPUSDT": 0.0001,
}


def tick_size_for_symbol(symbol: str) -> float:
    key = symbol.replace("/", "").upper()
    return _TICK_SIZE_BY_SYMBOL.get(key, 0.01)


def _decimal_places(tick_size: float) -> int:
    if tick_size <= 0:
        return 2
    text = f"{tick_size:.10f}".rstrip("0").rstrip(".")
    if "." not in text:
        return 0
    frac = text.split(".", 1)[1]
    return len(frac) if frac else 0


def format_market_price(price: float, symbol: str) -> str:
    tick = tick_size_for_symbol(symbol)
    decimals = _decimal_places(tick)
    rounded = round(price / tick) * tick if tick > 0 else price
    return f"{rounded:,.{decimals}f}"
