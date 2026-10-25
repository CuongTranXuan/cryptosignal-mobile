from __future__ import annotations

from typing import Literal

from cryptosignal_copilot.schema import Candle

Regime = Literal["trend_up", "trend_down", "range", "volatile"]


def detect_regime(candles: list[Candle]) -> Regime:
    """Rule-based regime from closes (independent of user prompt / bias)."""
    if len(candles) < 10:
        return "range"
    closes = [c.close for c in candles[-30:]]
    highs = [c.high for c in candles[-30:]]
    lows = [c.low for c in candles[-30:]]
    start = closes[0]
    end = closes[-1]
    if start <= 0:
        return "range"
    change = (end - start) / start
    span = max(highs) - min(lows)
    mid = (max(highs) + min(lows)) / 2
    volatility = span / mid if mid > 0 else 0.0
    if volatility > 0.08:
        return "volatile"
    if change > 0.02:
        return "trend_up"
    if change < -0.02:
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
