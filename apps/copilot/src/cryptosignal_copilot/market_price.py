"""Chart-aligned price formatting with exchange tick sizes."""

from __future__ import annotations

from cryptosignal_copilot.symbol_tick import tick_from_magnitude, tick_size_for_symbol


def _decimal_places(tick_size: float) -> int:
    if tick_size <= 0:
        return 8
    text = f"{tick_size:.16f}".rstrip("0").rstrip(".")
    if "." not in text:
        return 0
    frac = text.split(".", 1)[1]
    return len(frac) if frac else 0


def format_market_price(price: float, symbol: str) -> str:
    tick = tick_size_for_symbol(symbol, reference_price=abs(price))
    decimals = _decimal_places(tick)
    rounded = round(price / tick) * tick if tick > 0 else price
    if rounded == 0 and price != 0:
        rounded = price
        decimals = max(decimals, _decimal_places(tick_from_magnitude(abs(price))))
    formatted = f"{rounded:,.{decimals}f}"
    if formatted in {"0.00", "0.0000", "0"} and price != 0:
        sig = f"{price:.8g}"
        return sig
    return formatted
