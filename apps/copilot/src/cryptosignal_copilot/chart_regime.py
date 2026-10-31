from __future__ import annotations

from typing import Literal

from cryptosignal_copilot.features import IntervalName, wilder_atr, zigzag_mult, zigzag_swings
from cryptosignal_copilot.schema import Candle

Regime = Literal["trend_up", "trend_down", "range", "volatile"]


def _ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2.0 / (period + 1)
    out = [values[0]]
    for value in values[1:]:
        out.append(value * k + out[-1] * (1.0 - k))
    return out


def _market_structure(zz: list) -> Literal["up", "down", "range"]:
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    if len(highs) < 2 or len(lows) < 2:
        return "range"
    hh = highs[-1].price > highs[-2].price
    hl = lows[-1].price > lows[-2].price
    lh = highs[-1].price < highs[-2].price
    ll = lows[-1].price < lows[-2].price
    if hh and hl:
        return "up"
    if lh and ll:
        return "down"
    return "range"


def _volatile_regime(candles: list[Candle], atr: float | None) -> bool:
    if atr is None or len(candles) < 20:
        return False
    closes = [float(c.close) for c in candles]
    if closes[-1] <= 0:
        return False
    atr_pcts: list[float] = []
    for end in range(14, len(candles) + 1):
        window = candles[end - 14 : end]
        window_atr = wilder_atr(window)
        close = float(window[-1].close)
        if window_atr is not None and close > 0:
            atr_pcts.append(window_atr / close)
    if not atr_pcts:
        return False
    sorted_pcts = sorted(atr_pcts)
    median = sorted_pcts[len(sorted_pcts) // 2]
    last_pct = atr / closes[-1]
    return last_pct > 2.0 * median if median > 0 else False


def detect_regime(candles: list[Candle], interval: IntervalName = "1h") -> Regime:
    """Swing structure + EMA20/50 + ATR volatility (CHART_AI_SPEC §5.1)."""
    if len(candles) < 20:
        return "range"
    atr = wilder_atr(candles)
    if _volatile_regime(candles, atr):
        return "volatile"

    closes = [float(c.close) for c in candles]
    ema20 = _ema_series(closes, 20)
    ema50 = _ema_series(closes, 50)
    if len(ema20) < 11 or atr is None or atr <= 0:
        return "range"

    zz = zigzag_swings(candles, interval, atr_mult=zigzag_mult(interval))
    structure = _market_structure(zz)
    close_last = closes[-1]
    ema_slope = ema20[-1] - ema20[-11]
    ema_ok_up = close_last > ema50[-1] and ema_slope > 0.2 * atr
    ema_ok_down = close_last < ema50[-1] and ema_slope < -0.2 * atr

    if structure == "up" and ema_ok_up:
        return "trend_up"
    if structure == "down" and ema_ok_down:
        return "trend_down"
    return "range"


def bias_conflicts_regime(
    bias: str | None,
    regime: Regime,
) -> bool:
    if not bias or bias == "neutral":
        return False
    if bias == "bullish" and regime == "trend_down":
        return True
    if bias == "bearish" and regime == "trend_up":
        return True
    return False
