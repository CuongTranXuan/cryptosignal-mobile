"""Per-pattern broken checks using line value over time and swing anchors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from cryptosignal_copilot.features import ZigZagSwing
from cryptosignal_copilot.schema import Candle

if True:  # avoid circular import at runtime
    from cryptosignal_copilot.candidates import DrawingCandidate

Side = Literal["below", "above"]


def _line_price_at(t1: int, p1: float, t2: int, p2: float, t: int) -> float:
    if t2 == t1:
        return p1
    return p1 + (p2 - p1) * (t - t1) / (t2 - t1)


@dataclass(frozen=True)
class BrokenCheck:
    broken: bool
    reason: str = ""


def _zz_by_id(zigzag: list[ZigZagSwing]) -> dict[str, ZigZagSwing]:
    return {z.id: z for z in zigzag}


def swing_anchor_time(cand: DrawingCandidate, zigzag: list[ZigZagSwing]) -> int:
    by_id = _zz_by_id(zigzag)
    times = [by_id[sid].t for sid in cand.swing_ids if sid in by_id]
    if times:
        return max(times)
    times_from_shapes: list[int] = []
    for shape in cand.shapes:
        points = shape.get("points")
        if isinstance(points, list):
            for point in points:
                if isinstance(point, dict) and "time" in point:
                    times_from_shapes.append(int(point["time"]))
        t0 = shape.get("t0")
        if t0 is not None:
            times_from_shapes.append(int(t0))
    if times_from_shapes:
        return max(times_from_shapes)
    return 0


def _line_violated(
    candles: list[Candle],
    anchor_t: int,
    t1: int,
    p1: float,
    t2: int,
    p2: float,
    side: Side,
    buffer: float,
) -> bool:
    for candle in candles:
        if candle.time <= anchor_t:
            continue
        level = _line_price_at(t1, p1, t2, p2, candle.time)
        if side == "below" and candle.close < level - buffer:
            return True
        if side == "above" and candle.close > level + buffer:
            return True
    return False


def _zone_violated(
    candles: list[Candle],
    anchor_t: int,
    low: float,
    high: float,
    *,
    break_below: bool,
    buffer: float,
) -> bool:
    for candle in candles:
        if candle.time <= anchor_t:
            continue
        if break_below and candle.close < low - buffer:
            return True
        if not break_below and candle.close > high + buffer:
            return True
    return False


def _trendline_points(shape: dict) -> tuple[int, float, int, float] | None:
    points = shape.get("points")
    if not isinstance(points, list) or len(points) < 2:
        return None
    p1, p2 = points[0], points[1]
    if not isinstance(p1, dict) or not isinstance(p2, dict):
        return None
    return int(p1["time"]), float(p1["price"]), int(p2["time"]), float(p2["price"])


def pattern_broken(
    cand: DrawingCandidate,
    candles: list[Candle],
    atr: float | None,
    zigzag: list[ZigZagSwing],
) -> BrokenCheck:
    if not candles:
        return BrokenCheck(False)
    buffer = 0.25 * (atr or 1.0)
    anchor = swing_anchor_time(cand, zigzag)
    pid = cand.pattern_id

    if pid == "trendline" and cand.shapes:
        line = _trendline_points(cand.shapes[0])
        if line is None:
            return BrokenCheck(False)
        side: Side = "below" if "Support" in cand.name else "above"
        broken = _line_violated(candles, anchor, *line, side, buffer)
        return BrokenCheck(broken, "trendline broken" if broken else "")

    if pid in {"ascending_triangle", "descending_triangle", "symmetrical_triangle"}:
        upper = lower = None
        for shape in cand.shapes:
            name = str(shape.get("name", "")).lower()
            pts = _trendline_points(shape)
            if pts is None:
                continue
            if "upper" in name:
                upper = pts
            if "lower" in name:
                lower = pts
        if upper is None or lower is None:
            shapes_with_pts = [_trendline_points(s) for s in cand.shapes if _trendline_points(s)]
            shapes_with_pts = [s for s in shapes_with_pts if s is not None]
            if len(shapes_with_pts) >= 2:
                upper, lower = shapes_with_pts[0], shapes_with_pts[1]
        if upper and lower:
            if pid == "ascending_triangle":
                broken = _line_violated(candles, anchor, *lower, "below", buffer)
            elif pid == "descending_triangle":
                broken = _line_violated(candles, anchor, *upper, "above", buffer)
            else:
                broken = _line_violated(candles, anchor, *lower, "below", buffer) or _line_violated(
                    candles, anchor, *upper, "above", buffer
                )
            return BrokenCheck(broken, "triangle broken" if broken else "")

    if pid in {"channel_up", "channel_down"} and len(cand.shapes) >= 2:
        high_line = _trendline_points(cand.shapes[0])
        low_line = _trendline_points(cand.shapes[1])
        if high_line and low_line:
            if pid == "channel_up":
                broken = _line_violated(candles, anchor, *low_line, "below", buffer)
            else:
                broken = _line_violated(candles, anchor, *high_line, "above", buffer)
            return BrokenCheck(broken, "channel broken" if broken else "")

    if pid == "liquidity" and cand.shapes:
        line = _trendline_points(cand.shapes[0])
        if line:
            side = "above" if "high" in cand.name.lower() else "below"
            broken = _line_violated(candles, anchor, *line, side, buffer)
            return BrokenCheck(broken, "liquidity swept" if broken else "")

    if pid in {"bos", "choch"} and cand.shapes:
        line = _trendline_points(cand.shapes[0])
        if line:
            bullish = "bull" in cand.name.lower()
            side = "below" if bullish else "above"
            broken = _line_violated(candles, anchor, *line, side, buffer)
            return BrokenCheck(broken, "structure broken" if broken else "")

    zone_shape = cand.shapes[0] if cand.shapes else {}
    low = zone_shape.get("priceLow")
    high = zone_shape.get("priceHigh")
    if low is not None and high is not None:
        low_f, high_f = float(low), float(high)
        if pid == "support_resistance":
            by_id = _zz_by_id(zigzag)
            swings = [by_id[sid] for sid in cand.swing_ids if sid in by_id]
            if "resistance (flipped)" in cand.name.lower():
                break_below = False
            elif "support (flipped)" in cand.name.lower():
                break_below = True
            elif swings:
                break_below = swings[0].side == "low"
            else:
                break_below = True
            broken = _zone_violated(
                candles,
                anchor,
                low_f,
                high_f,
                break_below=break_below,
                buffer=buffer,
            )
            return BrokenCheck(broken, "zone broken" if broken else "")

        if pid == "fvg":
            bullish = "bull" in cand.name.lower()
            broken = _zone_violated(
                candles,
                anchor,
                low_f,
                high_f,
                break_below=bullish,
                buffer=0.0,
            )
            return BrokenCheck(broken, "fvg mitigated" if broken else "")

        if pid == "order_block":
            bullish = "bull" in cand.name.lower()
            broken = _zone_violated(
                candles,
                anchor,
                low_f,
                high_f,
                break_below=bullish,
                buffer=buffer,
            )
            return BrokenCheck(broken, "order block broken" if broken else "")

    if cand.invalidation_price is not None:
        inv = cand.invalidation_price
        inv_side: Side
        if pid in {"double_bottom", "inverse_head_and_shoulders"}:
            inv_side = "below"
        elif pid in {"double_top", "head_and_shoulders"}:
            inv_side = "above"
        else:
            last_close = float(candles[-1].close)
            inv_side = "below" if inv < last_close else "above"
        for candle in candles:
            if candle.time <= anchor:
                continue
            if inv_side == "below" and candle.close < inv - buffer:
                return BrokenCheck(True, "invalidation breached")
            if inv_side == "above" and candle.close > inv + buffer:
                return BrokenCheck(True, "invalidation breached")

    return BrokenCheck(False)
