"""Geometry gate for agent drawings.

Keeps trendline / polyline / zone shapes that are still in play, allows one
forward endpoint on the interval projection grid, and rejects triangle rays
past the computed apex.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Literal, Never, Protocol, Sequence, assert_never

logger = logging.getLogger(__name__)

IntervalName = Literal["1m", "15m", "1h", "4h", "1d"]
SwingSide = Literal["high", "low"]

# Interval k table is the default. COPILOT_PROJECT_BARS overrides it.
# Hard ceiling matches the web overlay (shape-projection.ts).
HARD_MAX_PROJECTION_BARS = 48
ENV_PROJECT_BARS = "COPILOT_PROJECT_BARS"

MIN_CONFIDENCE = 0.55
THIRD_TOUCH_CONFIDENCE = 0.7
ANCIENT_FRACTION = 0.35
TRENDLINE_MIN_BARS = 8
POLYLINE_MIN_BARS = 12
TRIANGLE_MIN_BARS = 15
SWING_MIN_BARS_APART = 5
IMPULSE_ATR_MULT = 1.5
ATR_PERIOD = 14
APEX_EXTRA_BARS = 3
APEX_TIME_EPSILON_S = 1e-4
MAX_SHAPES = 6
GRID_K_EPSILON = 1e-3

# TODO(researcher): chart-normalized near-vertical cutoff. Not env-tunable yet.
NEAR_VERTICAL_SLOPE = 4.0
# TODO(researcher): wick snap band. Not env-tunable yet.
WICK_ATR_FRACTION = 0.15
WICK_PRICE_FRACTION = 0.002

_UPPER_RE = re.compile(r"\bupper\b|\bresistance\b|\btop\b|cạnh trên|kháng cự", re.IGNORECASE)
_LOWER_RE = re.compile(r"\blower\b|\bsupport\b|\bbottom\b|cạnh dưới|hỗ trợ", re.IGNORECASE)
_TRIANGLE_RE = re.compile(
    r"\btriangle\b|tam giác|\bsymmetr\w*|\bascending\b|\bdescending\b",
    re.IGNORECASE,
)
_FIB_LEVEL_RE = re.compile(r"^Fib (?:0\.382|0\.5|0\.618|1\.272|1\.618)$")


class CandleLike(Protocol):
    time: int
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class DrawingWindow:
    """Closed-candle window the geometry gate measures against."""

    candles: Sequence[CandleLike]
    interval: IntervalName
    window_start: int | None = None
    allowed_times: set[int] | None = None


@dataclass(frozen=True)
class Swing:
    index: int
    time: int
    price: float
    side: SwingSide


@dataclass(frozen=True)
class _GateContext:
    candles: list[CandleLike]
    interval: IntervalName
    bar_seconds: int
    last_closed: int
    window_start: int
    allowed: set[int] | None
    max_k: int
    atr: float | None
    swings: list[Swing]
    tolerance: float
    candle_by_time: dict[int, CandleLike]


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


def fractal_radius(interval: IntervalName) -> int:
    """Williams fractal radius: K=2 on 1m/15m, K=3 on 1h and higher."""
    match interval:
        case "1m" | "15m":
            return 2
        case "1h" | "4h" | "1d":
            return 3
        case _ as unreachable:
            assert_never(unreachable)


def table_project_bars(interval: IntervalName) -> int:
    match interval:
        case "1m":
            return 30
        case "15m" | "1h":
            return 24
        case "4h":
            return 18
        case "1d":
            return 12
        case _ as unreachable:
            assert_never(unreachable)


def project_bars_override() -> int | None:
    """Optional COPILOT_PROJECT_BARS. Invalid values fall back to the k table."""
    raw = os.environ.get(ENV_PROJECT_BARS, "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        logger.warning("ignoring invalid %s=%r", ENV_PROJECT_BARS, raw)
        return None
    if value <= 0:
        logger.warning("ignoring non-positive %s=%s", ENV_PROJECT_BARS, value)
        return None
    return value


def effective_project_bars(interval: IntervalName) -> int:
    override = project_bars_override()
    chosen = table_project_bars(interval) if override is None else override
    return min(chosen, HARD_MAX_PROJECTION_BARS)


def projection_time_reason(
    time: int,
    *,
    last_closed: int,
    bar_seconds: int,
    max_k: int,
) -> str | None:
    """None when `time` is an allowed forward grid point. k caps are a hard ceiling."""
    if time <= last_closed:
        return None
    if bar_seconds <= 0:
        return "off-grid"
    k = (time - last_closed) / bar_seconds
    rounded = round(k)
    if rounded < 1 or abs(k - rounded) >= GRID_K_EPSILON:
        return "off-grid"
    if rounded > max_k:
        return "beyond-k"
    return None


def line_intersection(
    a1: tuple[float, float],
    a2: tuple[float, float],
    b1: tuple[float, float],
    b2: tuple[float, float],
) -> tuple[float, float] | None:
    """Intersection of two infinite lines in (time, price) space.

    Times are translated near the origin so unix-second products stay exact.
    Parallel lines (channels) return None. No apexTime field is emitted.
    """
    x1, y1 = float(a1[0]), float(a1[1])
    x2, y2 = float(a2[0]), float(a2[1])
    x3, y3 = float(b1[0]), float(b1[1])
    x4, y4 = float(b2[0]), float(b2[1])
    origin = min(x1, x2, x3, x4)
    x1 -= origin
    x2 -= origin
    x3 -= origin
    x4 -= origin
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    scale = max(abs(x1 - x2), abs(x3 - x4), 1.0) * max(abs(y1 - y2), abs(y3 - y4), 1.0)
    if abs(den) <= 1e-9 * max(scale, 1.0):
        return None
    px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den
    py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den
    return px + origin, py


def forward_past_apex(forward_time: float, apex_time: float, bar_seconds: int) -> bool:
    """True when a forward endpoint is strictly after apex + 3 bars."""
    limit = apex_time + APEX_EXTRA_BARS * bar_seconds
    return forward_time > limit + APEX_TIME_EPSILON_S


def apply_preview_gate(
    shapes: list[dict[str, Any]],
    window: DrawingWindow,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Drop shapes that fail the in-play gate. Never raises."""
    dropped: list[str] = []
    try:
        ctx = build_context(window)
    except Exception:
        logger.exception("drawing gate context failed; dropping shapes")
        return [], [_shape_id(shape) for shape in shapes]

    if ctx is None:
        for shape in shapes:
            shape_id = _shape_id(shape)
            logger.info("drop shape %s: no-candles", shape_id)
            dropped.append(shape_id)
        return [], dropped

    kept: list[dict[str, Any]] = []
    for shape in shapes:
        shape_id = _shape_id(shape)
        try:
            reviewed, reason = _review(shape, ctx)
        except Exception:
            logger.exception("drawing gate failed; dropping shape %s", shape_id)
            dropped.append(shape_id)
            continue
        if reviewed is None:
            logger.info("drop shape %s: %s", shape_id, reason)
            dropped.append(shape_id)
            continue
        kept.append(reviewed)

    kept, apex_dropped = reject_forward_past_apex(kept, ctx)
    for shape_id in apex_dropped:
        logger.info("drop shape %s: apex", shape_id)
        dropped.append(shape_id)

    kept, cap_dropped = _cap_shapes(kept, MAX_SHAPES)
    for shape_id in cap_dropped:
        logger.info("drop shape %s: cap", shape_id)
        dropped.append(shape_id)
    return kept, dropped


def review_shape(
    shape: dict[str, Any],
    window: DrawingWindow,
) -> tuple[dict[str, Any] | None, str | None]:
    """Return (shape, None) to keep or (None, reason) to drop. Does not apply apex pairing."""
    ctx = build_context(window)
    if ctx is None:
        return None, "no-candles"
    return _review(shape, ctx)


def reject_forward_past_apex(
    shapes: list[dict[str, Any]],
    ctx: _GateContext,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Drop triangle rails whose forward endpoint is later than apex + 3 bars."""
    trendlines = [
        shape
        for shape in shapes
        if shape.get("kind") == "trendline" and isinstance(shape.get("points"), list) and len(shape["points"]) == 2
    ]
    drop_ids: set[str] = set()
    for index, left in enumerate(trendlines):
        for right in trendlines[index + 1 :]:
            if not _is_upper_lower_pair(left, right):
                continue
            apex = line_intersection(
                _point_tuple(left["points"][0]),
                _point_tuple(left["points"][1]),
                _point_tuple(right["points"][0]),
                _point_tuple(right["points"][1]),
            )
            if apex is None:
                continue
            apex_time = apex[0]
            for shape in (left, right):
                forward = _forward_time(shape, ctx.last_closed)
                if forward is None:
                    continue
                if forward_past_apex(forward, apex_time, ctx.bar_seconds):
                    drop_ids.add(str(shape.get("id", "?")))
    if not drop_ids:
        return shapes, []
    kept = [shape for shape in shapes if str(shape.get("id", "?")) not in drop_ids]
    dropped = [str(shape.get("id", "?")) for shape in shapes if str(shape.get("id", "?")) in drop_ids]
    return kept, dropped


def build_context(window: DrawingWindow) -> _GateContext | None:
    dedup: dict[int, CandleLike] = {}
    for candle in window.candles:
        dedup[int(candle.time)] = candle
    candles = [dedup[time] for time in sorted(dedup)]
    if window.window_start is not None:
        clipped = [candle for candle in candles if int(candle.time) >= window.window_start]
        if clipped:
            candles = clipped
    if not candles:
        return None
    last_closed = int(candles[-1].time)
    start = int(candles[0].time) if window.window_start is None else int(window.window_start)
    atr = _wilder_atr(candles, ATR_PERIOD)
    swings = _fractal_swings(candles, window.interval)
    return _GateContext(
        candles=candles,
        interval=window.interval,
        bar_seconds=bar_seconds(window.interval),
        last_closed=last_closed,
        window_start=start,
        allowed=set(window.allowed_times) if window.allowed_times is not None else None,
        max_k=effective_project_bars(window.interval),
        atr=atr,
        swings=swings,
        tolerance=_price_tolerance(candles, atr),
        candle_by_time={int(candle.time): candle for candle in candles},
    )


def _review(shape: dict[str, Any], ctx: _GateContext) -> tuple[dict[str, Any] | None, str | None]:
    data = _copy_shape(shape)
    if str(data.get("interval")) != ctx.interval:
        return None, "interval-mismatch"
    try:
        confidence = float(data.get("confidence"))
    except (TypeError, ValueError):
        return None, "confidence"
    if confidence < MIN_CONFIDENCE:
        return None, "confidence"
    data["confidence"] = confidence

    kind = str(data.get("kind"))
    points = data.get("points")
    if not isinstance(points, list):
        return None, "no-anchor"
    reason = _check_point_times(points, str(data.get("source")), ctx)
    if reason:
        return None, reason

    if kind == "zone":
        return _review_zone(data, points, ctx)
    if kind == "trendline":
        return _review_trendline(data, points, ctx)
    if kind == "polyline":
        return _review_polyline(data, points, ctx)
    return None, "kind"


def _review_zone(
    data: dict[str, Any],
    points: list[Any],
    ctx: _GateContext,
) -> tuple[dict[str, Any] | None, str | None]:
    if len(points) < 1:
        return None, "zone-without-time"
    touch = _last_historical_time(points, ctx.last_closed)
    if touch is None:
        return None, "no-anchor"
    if _is_ancient(touch, ctx):
        return None, "ancient"
    return data, None


def _review_trendline(
    data: dict[str, Any],
    points: list[Any],
    ctx: _GateContext,
) -> tuple[dict[str, Any] | None, str | None]:
    if len(points) != 2:
        return None, "no-anchor"
    name = str(data.get("name", ""))
    p1, p2 = points[0], points[1]
    if not isinstance(p1, dict) or not isinstance(p2, dict):
        return None, "no-anchor"
    if _FIB_LEVEL_RE.match(name) and not _prices_equal(float(p1["price"]), float(p2["price"])):
        return None, "fib-not-horizontal"
    if _prices_equal(float(p1["price"]), float(p2["price"])):
        return _review_horizontal(data, points, ctx)
    return _review_diagonal(data, points, ctx)


def _review_horizontal(
    data: dict[str, Any],
    points: list[Any],
    ctx: _GateContext,
) -> tuple[dict[str, Any] | None, str | None]:
    times = [int(point["time"]) for point in points]
    if _span_bars(times, ctx.bar_seconds) + 1e-9 < TRENDLINE_MIN_BARS:
        return None, "short-span"
    touch = _last_historical_time(points, ctx.last_closed)
    if touch is None:
        return None, "no-anchor"
    if _is_ancient(touch, ctx):
        return None, "ancient"
    return data, None


def _review_diagonal(
    data: dict[str, Any],
    points: list[Any],
    ctx: _GateContext,
) -> tuple[dict[str, Any] | None, str | None]:
    historical = [point for point in points if int(point["time"]) <= ctx.last_closed]
    if not historical:
        return None, "no-anchor"
    sides: list[SwingSide] = []
    for point in historical:
        swing, reason = _anchor_swing(point, ctx)
        if swing is None:
            return None, reason or "not-swing"
        sides.append(swing.side)
    if len(set(sides)) != 1:
        return None, "mixed-side"
    side = sides[0]
    hits = _line_hits(points, ctx, side)
    if len(hits) < 2:
        return None, "single-touch"
    if data["confidence"] > THIRD_TOUCH_CONFIDENCE and len(hits) < 3:
        data["confidence"] = THIRD_TOUCH_CONFIDENCE
    need = _required_span(str(data.get("kind")), str(data.get("name", "")))
    hit_times = [hit.time for hit in hits]
    if _span_bars(hit_times, ctx.bar_seconds) + 1e-9 < need:
        return None, "short-span"
    if _is_ancient(max(hit_times), ctx):
        return None, "ancient"
    if _segment_near_vertical(points, ctx):
        return None, "near-vertical"
    return data, None


def _review_polyline(
    data: dict[str, Any],
    points: list[Any],
    ctx: _GateContext,
) -> tuple[dict[str, Any] | None, str | None]:
    historical = [point for point in points if isinstance(point, dict) and int(point["time"]) <= ctx.last_closed]
    if len(historical) < 2:
        return None, "no-anchor"
    for point in historical:
        swing, reason = _anchor_swing(point, ctx)
        if swing is None:
            return None, reason or "not-swing"
    times = [int(point["time"]) for point in historical]
    if _span_bars(times, ctx.bar_seconds) + 1e-9 < POLYLINE_MIN_BARS:
        return None, "short-span"
    if _is_ancient(max(times), ctx):
        return None, "ancient"
    if _segment_near_vertical(points, ctx):
        return None, "near-vertical"
    return data, None


def _check_point_times(points: list[Any], source: str, ctx: _GateContext) -> str | None:
    if not points:
        return None
    futures: list[int] = []
    for point in points:
        if not isinstance(point, dict):
            return "off-candle"
        try:
            time = int(point["time"])
        except (KeyError, TypeError, ValueError):
            return "off-candle"
        if time < ctx.window_start:
            return "before-window"
        if time <= ctx.last_closed:
            if time not in ctx.candle_by_time:
                return "off-candle"
            if ctx.allowed is not None and time not in ctx.allowed:
                return "off-candle"
        else:
            futures.append(time)
    if len(futures) > 1:
        return "multiple-future"
    if len(futures) == 1:
        latest = max(int(point["time"]) for point in points if isinstance(point, dict))
        if futures[0] != latest:
            return "future-not-endpoint"
        if source != "agent":
            return "human-future"
        return projection_time_reason(
            futures[0],
            last_closed=ctx.last_closed,
            bar_seconds=ctx.bar_seconds,
            max_k=ctx.max_k,
        )
    return None


def _anchor_swing(point: dict[str, Any], ctx: _GateContext) -> tuple[Swing | None, str | None]:
    time = int(point["time"])
    candle = ctx.candle_by_time.get(time)
    if candle is None:
        return None, "off-candle"
    price = float(point["price"])
    near_high = abs(price - float(candle.high)) <= ctx.tolerance
    near_low = abs(price - float(candle.low)) <= ctx.tolerance
    if not near_high and not near_low:
        return None, "not-swing"
    if near_high and near_low:
        side: SwingSide = "high" if abs(price - candle.high) <= abs(price - candle.low) else "low"
    elif near_high:
        side = "high"
    else:
        side = "low"
    for swing in ctx.swings:
        if swing.time == time and swing.side == side and abs(swing.price - price) <= ctx.tolerance:
            if not _has_impulse(swing, ctx):
                return None, "impulse"
            return swing, None
    return None, "not-swing"


def _line_hits(points: list[Any], ctx: _GateContext, side: SwingSide) -> list[Swing]:
    if len(points) < 2:
        return []
    hits: list[Swing] = []
    for swing in ctx.swings:
        if swing.side != side or swing.time > ctx.last_closed:
            continue
        projected = _price_at(points[0], points[-1], swing.time)
        if projected is None:
            continue
        if abs(projected - swing.price) <= ctx.tolerance:
            hits.append(swing)
    return hits


def _has_impulse(swing: Swing, ctx: _GateContext) -> bool:
    if ctx.atr is None or ctx.atr <= 0:
        return True
    previous: Swing | None = None
    for other in ctx.swings:
        if other.side == swing.side or other.index >= swing.index:
            continue
        previous = other
    if previous is None:
        return True
    return abs(swing.price - previous.price) >= IMPULSE_ATR_MULT * ctx.atr


def _segment_near_vertical(points: list[Any], ctx: _GateContext) -> bool:
    for left, right in zip(points, points[1:]):
        if _prices_equal(float(left["price"]), float(right["price"])):
            continue
        if _is_near_vertical(int(left["time"]), float(left["price"]), int(right["time"]), float(right["price"]), ctx):
            return True
    return False


def _is_near_vertical(t1: int, p1: float, t2: int, p2: float, ctx: _GateContext) -> bool:
    if len(ctx.candles) < 2:
        return False
    time_span = ctx.last_closed - int(ctx.candles[0].time)
    price_hi = max(float(candle.high) for candle in ctx.candles)
    price_lo = min(float(candle.low) for candle in ctx.candles)
    price_span = price_hi - price_lo
    if time_span <= 0 or price_span <= 0:
        return t1 == t2 and p1 != p2
    dx = abs(t2 - t1) / time_span
    dy = abs(p2 - p1) / price_span
    if dx <= 1e-9:
        return True
    return dy / dx >= NEAR_VERTICAL_SLOPE


def _is_ancient(touch_time: int, ctx: _GateContext) -> bool:
    if len(ctx.candles) < 2:
        return False
    start = int(ctx.candles[0].time)
    span = ctx.last_closed - start
    if span <= 0:
        return False
    return (touch_time - start) / span < ANCIENT_FRACTION


def _fractal_swings(candles: list[CandleLike], interval: IntervalName) -> list[Swing]:
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
        if high > max(float(candle.high) for candle in left) and high > max(float(candle.high) for candle in right):
            found.append(Swing(index, int(candles[index].time), high, "high"))
        if low < min(float(candle.low) for candle in left) and low < min(float(candle.low) for candle in right):
            found.append(Swing(index, int(candles[index].time), low, "low"))
    highs = _thin_swings([swing for swing in found if swing.side == "high"])
    lows = _thin_swings([swing for swing in found if swing.side == "low"])
    return sorted(highs + lows, key=lambda swing: (swing.index, swing.side))


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


def _more_extreme(candidate: Swing, incumbent: Swing) -> bool:
    if candidate.side == "high":
        return candidate.price > incumbent.price
    return candidate.price < incumbent.price


def _wilder_atr(candles: Sequence[CandleLike], period: int) -> float | None:
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


def _price_tolerance(candles: Sequence[CandleLike], atr: float | None) -> float:
    ref = max((abs(float(candle.close)) for candle in candles), default=1.0)
    atr_tol = WICK_ATR_FRACTION * atr if atr is not None else 0.0
    return max(atr_tol, WICK_PRICE_FRACTION * ref, 1e-8)


def _required_span(kind: str, name: str) -> int:
    if kind == "polyline":
        return POLYLINE_MIN_BARS
    if kind == "trendline" and _TRIANGLE_RE.search(name):
        return TRIANGLE_MIN_BARS
    if kind == "trendline":
        return TRENDLINE_MIN_BARS
    return 0


def _span_bars(times: list[int], bar: int) -> float:
    if len(times) < 2 or bar <= 0:
        return 0.0
    return (max(times) - min(times)) / bar


def _last_historical_time(points: list[Any], last_closed: int) -> int | None:
    times = [int(point["time"]) for point in points if isinstance(point, dict) and int(point["time"]) <= last_closed]
    if not times:
        return None
    return max(times)


def _prices_equal(left: float, right: float) -> bool:
    scale = max(abs(left), abs(right), 1.0)
    return abs(left - right) <= max(1e-6, 1e-4 * scale)


def _price_at(p1: dict[str, Any], p2: dict[str, Any], time: int) -> float | None:
    t1 = float(p1["time"])
    t2 = float(p2["time"])
    if t1 == t2:
        return None
    frac = (time - t1) / (t2 - t1)
    return float(p1["price"]) + (float(p2["price"]) - float(p1["price"])) * frac


def _forward_time(shape: dict[str, Any], last_closed: int) -> float | None:
    points = shape.get("points")
    if not isinstance(points, list):
        return None
    future = [int(point["time"]) for point in points if isinstance(point, dict) and int(point["time"]) > last_closed]
    if len(future) != 1:
        return None
    return float(future[0])


def _point_tuple(point: dict[str, Any]) -> tuple[float, float]:
    return float(point["time"]), float(point["price"])


def _role(name: str) -> str:
    upper = _UPPER_RE.search(name) is not None
    lower = _LOWER_RE.search(name) is not None
    if upper and not lower:
        return "upper"
    if lower and not upper:
        return "lower"
    return "other"


def _is_upper_lower_pair(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return {_role(str(left.get("name", ""))), _role(str(right.get("name", "")))} == {"upper", "lower"}


def _cap_shapes(shapes: list[dict[str, Any]], limit: int) -> tuple[list[dict[str, Any]], list[str]]:
    if len(shapes) <= limit:
        return shapes, []
    ranked = sorted(range(len(shapes)), key=lambda index: (-float(shapes[index].get("confidence", 0)), index))
    keep = set(ranked[:limit])
    kept: list[dict[str, Any]] = []
    dropped: list[str] = []
    for index, shape in enumerate(shapes):
        if index in keep:
            kept.append(shape)
        else:
            dropped.append(str(shape.get("id", "?")))
    return kept, dropped


def _copy_shape(shape: dict[str, Any]) -> dict[str, Any]:
    data = dict(shape)
    points = shape.get("points")
    if isinstance(points, list):
        data["points"] = [dict(point) if isinstance(point, dict) else point for point in points]
    return data


def _shape_id(shape: Any) -> str:
    if isinstance(shape, dict):
        return str(shape.get("id", "?"))
    return "?"
