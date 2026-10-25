"""Shared chart features: fractal swings, Wilder ATR, ZigZag, compact feature sheets."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, assert_never

IntervalName = Literal["1m", "15m", "1h", "4h", "1d"]
SwingSide = Literal["high", "low"]

SWING_MIN_BARS_APART = 5
ATR_PERIOD = 14
DEFAULT_ZIGZAG_ATR_MULT = 2.0


class CandleLike(Protocol):
    time: int
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class Swing:
    index: int
    time: int
    price: float
    side: SwingSide


@dataclass(frozen=True)
class ZigZagSwing:
    id: str
    i: int
    t: int
    side: SwingSide
    price: float
    prominence_atr: float


def fractal_radius(interval: IntervalName) -> int:
    match interval:
        case "1m" | "15m":
            return 2
        case "1h" | "4h" | "1d":
            return 3
        case _ as unreachable:
            assert_never(unreachable)


def bar_seconds(interval: IntervalName) -> int:
    match interval:
        case "1m":
            return 60
        case "15m":
            return 15 * 60
        case "1h":
            return 60 * 60
        case "4h":
            return 4 * 60 * 60
        case "1d":
            return 24 * 60 * 60
        case _ as unreachable:
            assert_never(unreachable)


def wilder_atr(candles: Sequence[CandleLike], period: int = ATR_PERIOD) -> float | None:
    if len(candles) < 2:
        return None
    true_ranges: list[float] = []
    for index, candle in enumerate(candles):
        high_low = float(candle.high) - float(candle.low)
        if index == 0:
            true_ranges.append(high_low)
            continue
        prev_close = float(candles[index - 1].close)
        true_ranges.append(
            max(high_low, abs(float(candle.high) - prev_close), abs(float(candle.low) - prev_close))
        )
    if len(true_ranges) < period:
        return sum(true_ranges) / len(true_ranges)
    atr = sum(true_ranges[:period]) / period
    for true_range in true_ranges[period:]:
        atr = (atr * (period - 1) + true_range) / period
    return atr


def _more_extreme(candidate: Swing, incumbent: Swing) -> bool:
    if candidate.side == "high":
        return candidate.price > incumbent.price
    return candidate.price < incumbent.price


def _thin_swings(swings: list[Swing]) -> list[Swing]:
    ordered = sorted(swings, key=lambda swing: swing.index)
    kept: list[Swing] = []
    for swing in ordered:
        if not kept or swing.index - kept[-1].index >= SWING_MIN_BARS_APART:
            kept.append(swing)
            continue
        if _more_extreme(swing, kept[-1]):
            kept[-1] = swing
    return kept


def _provisional_edge_swings(candles: list[CandleLike], radius: int) -> list[Swing]:
    count = len(candles)
    if count < radius + 1:
        return []
    region_start = max(radius, count - radius)
    if region_start >= count:
        return []
    region = range(region_start, count)
    found: list[Swing] = []
    high_index = max(region, key=lambda index: float(candles[index].high))
    high = float(candles[high_index].high)
    left = candles[high_index - radius : high_index]
    if left and high > max(float(candle.high) for candle in left):
        found.append(Swing(high_index, int(candles[high_index].time), high, "high"))
    low_index = min(region, key=lambda index: float(candles[index].low))
    low = float(candles[low_index].low)
    left_low = candles[low_index - radius : low_index]
    if left_low and low < min(float(candle.low) for candle in left_low):
        found.append(Swing(low_index, int(candles[low_index].time), low, "low"))
    return found


def fractal_swings(candles: list[CandleLike], interval: IntervalName) -> list[Swing]:
    radius = fractal_radius(interval)
    count = len(candles)
    found: list[Swing] = []
    if count < 2 * radius + 1:
        return []
    for index in range(radius, count - radius):
        high = float(candles[index].high)
        low = float(candles[index].low)
        left = candles[index - radius : index]
        right = candles[index + 1 : index + radius + 1]
        if high > max(float(candle.high) for candle in left) and high > max(
            float(candle.high) for candle in right
        ):
            found.append(Swing(index, int(candles[index].time), high, "high"))
        if low < min(float(candle.low) for candle in left) and low < min(
            float(candle.low) for candle in right
        ):
            found.append(Swing(index, int(candles[index].time), low, "low"))
    found.extend(_provisional_edge_swings(candles, radius))
    highs = _thin_swings([swing for swing in found if swing.side == "high"])
    lows = _thin_swings([swing for swing in found if swing.side == "low"])
    return sorted(highs + lows, key=lambda swing: (swing.index, 0 if swing.side == "high" else 1))


def _zigzag_id(side: SwingSide, time: int, price: float) -> str:
    digest = hashlib.sha256(f"zz|{side}|{time}|{price:.8f}".encode()).hexdigest()[:10]
    return f"zz_{side}_{digest}"


def fractals_as_zigzag(candles: list[CandleLike], interval: IntervalName) -> list[ZigZagSwing]:
    return [
        ZigZagSwing(
            id=_zigzag_id(swing.side, swing.time, swing.price),
            i=swing.index,
            t=swing.time,
            side=swing.side,
            price=swing.price,
            prominence_atr=0.5,
        )
        for swing in fractal_swings(candles, interval)
    ]


def zigzag_swings(
    candles: list[CandleLike],
    interval: IntervalName,
    *,
    atr_mult: float = DEFAULT_ZIGZAG_ATR_MULT,
) -> list[ZigZagSwing]:
    """ZigZag pivots with reversal threshold k×ATR."""
    atr = wilder_atr(candles) or 1.0
    threshold = atr_mult * atr
    fractals = fractal_swings(candles, interval)
    if not fractals:
        return []
    pivots: list[Swing] = [fractals[0]]
    for swing in fractals[1:]:
        last = pivots[-1]
        move = abs(swing.price - last.price)
        if swing.side == last.side:
            if _more_extreme(swing, last):
                pivots[-1] = swing
            continue
        if move < threshold:
            continue
        pivots.append(swing)
    out: list[ZigZagSwing] = []
    for swing in pivots:
        prom = abs(swing.price - pivots[0].price) / atr if atr > 0 else 0.0
        out.append(
            ZigZagSwing(
                id=_zigzag_id(swing.side, swing.time, swing.price),
                i=swing.index,
                t=swing.time,
                side=swing.side,
                price=swing.price,
                prominence_atr=round(prom, 3),
            )
        )
    return out


def htf_summary(candles: Sequence[CandleLike], interval: IntervalName) -> dict[str, Any]:
    """Compact higher-timeframe context from the same window (bucket aggregation)."""
    if len(candles) < 4:
        return {"bars": 0, "trend": "flat", "range_pct": 0.0}
    bucket = 4 if interval in ("1m", "15m") else 3
    closes = [c.close for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    buckets: list[float] = []
    for start in range(0, len(closes) - bucket + 1, bucket):
        buckets.append(sum(closes[start : start + bucket]) / bucket)
    if len(buckets) < 2:
        buckets = closes[-10:]
    start_p, end_p = buckets[0], buckets[-1]
    change = (end_p - start_p) / start_p if start_p else 0.0
    span = max(highs) - min(lows)
    mid = (max(highs) + min(lows)) / 2
    range_pct = span / mid if mid else 0.0
    trend = "up" if change > 0.01 else "down" if change < -0.01 else "flat"
    return {
        "bars": len(buckets),
        "trend": trend,
        "change_pct": round(change * 100, 2),
        "range_pct": round(range_pct * 100, 2),
        "last_close": closes[-1],
    }


def build_feature_sheet(
    candles: Sequence[CandleLike],
    interval: IntervalName,
    *,
    zigzag: list[ZigZagSwing] | None = None,
) -> dict[str, Any]:
    atr = wilder_atr(candles)
    zz = zigzag if zigzag is not None else zigzag_swings(candles, interval)
    swings_compact = [
        {
            "id": z.id,
            "t": z.t,
            "side": z.side,
            "price": round(z.price, 6),
            "prom_atr": z.prominence_atr,
        }
        for z in zz[-12:]
    ]
    return {
        "atr14": round(atr, 6) if atr is not None else None,
        "swing_count": len(zz),
        "swings": swings_compact,
        "htf": htf_summary(candles, interval),
    }


def compact_candle_row(c: CandleLike) -> list[float]:
    return [c.time, c.open, c.high, c.low, c.close, c.volume]
