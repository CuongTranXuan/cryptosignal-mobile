"""Rule-based drawing candidates with detector scores."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Literal

from cryptosignal_copilot.chart_regime import Regime, detect_regime
from cryptosignal_copilot.drawing_gate import (
    DrawingWindow,
    _price_inside_bar,
    _price_on_wick,
    _price_tolerance,
)
from cryptosignal_copilot.features import (
    ZigZagSwing,
    bar_seconds,
    fractals_as_zigzag,
    wilder_atr,
    zigzag_mult,
    zigzag_swings,
)
from cryptosignal_copilot.gate_policy import anchor_in_play, prefilter_candidate
from cryptosignal_copilot.schema import Candle, Interval

StyleId = Literal["classic", "smc"]
PatternId = str

CLASSIC_PATTERNS: frozenset[str] = frozenset(
    {
        "head_and_shoulders",
        "inverse_head_and_shoulders",
        "double_top",
        "double_bottom",
        "ascending_triangle",
        "descending_triangle",
        "symmetrical_triangle",
        "channel_up",
        "channel_down",
        "trendline",
        "support_resistance",
        "fib_retracement",
    }
)
SMC_PATTERNS: frozenset[str] = frozenset({"bos", "choch", "fvg", "order_block", "liquidity"})
PATTERNS_WITH_DETECTORS: frozenset[str] = CLASSIC_PATTERNS | SMC_PATTERNS


@dataclass
class DrawingCandidate:
    id: str
    pattern_id: PatternId
    style: StyleId
    score: float
    swing_ids: list[str]
    shapes: list[dict[str, Any]]
    evidence_against: list[str] = field(default_factory=list)
    invalidation_price: float | None = None
    break_time: int | None = None
    name: str = ""


@dataclass(frozen=True)
class PrefilterDrop:
    candidate_id: str
    pattern_id: str
    reason: str


@dataclass
class CandidateCatalog:
    symbol: str
    interval: Interval
    regime: Regime
    atr: float | None
    zigzag: list[ZigZagSwing]
    candidates: list[DrawingCandidate]
    raw_candidate_count: int = 0
    prefilter_dropped: list[PrefilterDrop] = field(default_factory=list)

    def by_id(self) -> dict[str, DrawingCandidate]:
        return {c.id: c for c in self.candidates}

    def ids_for_style(self, style: str) -> list[str]:
        return [c.id for c in self.candidates if c.style == style]

    def nearest_ids(self, bad_id: str, limit: int = 3) -> list[str]:
        pool = [c.id for c in self.candidates]
        if not pool:
            return []
        bad = bad_id.lower()
        ranked = sorted(pool, key=lambda cid: _id_distance(bad, cid.lower()))
        return ranked[:limit]


def _id_distance(a: str, b: str) -> int:
    if a in b or b in a:
        return 0
    return abs(len(a) - len(b)) + sum(1 for x, y in zip(a, b, strict=False) if x != y)


def _cand_id(prefix: str, *parts: object) -> str:
    raw = "|".join(str(p) for p in parts)
    digest = hashlib.sha256(f"{prefix}|{raw}".encode()).hexdigest()[:12]
    return f"{prefix}_{digest}"


def _geometry_score(
    *,
    fit: float = 0.5,
    touches: int = 2,
    size_atr: float = 1.0,
    recency: float = 0.5,
    span_bars: float = 20.0,
) -> float:
    touch = min(1.0, touches / 4.0)
    size = min(1.0, size_atr / 3.0)
    span = min(1.0, span_bars / 40.0)
    return round(0.30 * fit + 0.20 * touch + 0.15 * size + 0.15 * recency + 0.10 * span + 0.05, 3)


def _line_price_at(t1: int, p1: float, t2: int, p2: float, t: int) -> float:
    if t2 == t1:
        return p1
    return p1 + (p2 - p1) * (t - t1) / (t2 - t1)


def _lines_apex_time(
    t1: int,
    p1: float,
    t2: int,
    p2: float,
    u1: int,
    q1: float,
    u2: int,
    q2: float,
) -> float | None:
    if t2 == t1 or u2 == u1:
        return None
    m1 = (p2 - p1) / (t2 - t1)
    m2 = (q2 - q1) / (u2 - u1)
    if abs(m1 - m2) < 1e-15:
        return None
    return (q1 - p1 + m1 * t1 - m2 * u1) / (m1 - m2)


def _trendline_touch_count(
    swings: list[ZigZagSwing],
    t1: int,
    p1: float,
    t2: int,
    p2: float,
    tol: float,
) -> int:
    touches = 0
    for swing in swings:
        if swing.t < min(t1, t2) or swing.t > max(t1, t2):
            continue
        expected = _line_price_at(t1, p1, t2, p2, swing.t)
        if abs(swing.price - expected) <= tol:
            touches += 1
    return max(touches, 2)


def _last_anchor_time(cand: DrawingCandidate) -> int:
    times: list[int] = []
    for shape in cand.shapes:
        points = shape.get("points")
        if not isinstance(points, list):
            continue
        for point in points:
            if isinstance(point, dict) and "time" in point:
                times.append(int(point["time"]))
    return max(times) if times else 0


def _wick_safe_price(candle: Candle, price: float, tolerance: float) -> float:
    if not _price_inside_bar(price, candle) or _price_on_wick(price, candle, tolerance):
        return price
    return float(candle.low if price <= (candle.open + candle.close) / 2 else candle.high)


def _sr_zone_start_time(cand: DrawingCandidate) -> int:
    shape = cand.shapes[0] if cand.shapes else {}
    points = shape.get("points")
    if isinstance(points, list) and points:
        return int(points[0].get("time", 0))
    return cand.break_time or 0


def _sr_price_crossed_zone(
    candles: list[Candle], low_f: float, high_f: float, start_t: int
) -> bool:
    """True when closes traded from inside/below the band to above high, or inside/above to below low."""
    after = [float(c.close) for c in candles if c.time >= start_t]
    if not after:
        return False
    saw_at_or_below_high = False
    saw_at_or_above_low = False
    saw_above_high = False
    saw_below_low = False
    for close in after:
        if close <= high_f:
            saw_at_or_below_high = True
        if close >= low_f:
            saw_at_or_above_low = True
        if close > high_f:
            saw_above_high = True
        if close < low_f:
            saw_below_low = True
    crossed_up = saw_at_or_below_high and saw_above_high
    crossed_down = saw_at_or_above_low and saw_below_low
    return crossed_up or crossed_down


def _sr_role_from_last_close(cand: DrawingCandidate, candles: list[Candle]) -> DrawingCandidate:
    if cand.pattern_id != "support_resistance" or not candles:
        return cand
    shape = cand.shapes[0] if cand.shapes else {}
    low = shape.get("priceLow")
    high = shape.get("priceHigh")
    if low is None or high is None:
        return cand
    low_f, high_f = float(low), float(high)
    close = float(candles[-1].close)
    base_price = (low_f + high_f) / 2.0
    start_t = _sr_zone_start_time(cand)
    flipped = _sr_price_crossed_zone(candles, low_f, high_f, start_t)
    if close > high_f:
        role = "support"
        inv = low_f
    elif close < low_f:
        role = "resistance"
        inv = high_f
    else:
        return DrawingCandidate(
            id=cand.id,
            pattern_id=cand.pattern_id,
            style=cand.style,
            score=cand.score,
            swing_ids=cand.swing_ids,
            shapes=cand.shapes,
            evidence_against=list(cand.evidence_against),
            invalidation_price=cand.invalidation_price,
            break_time=cand.break_time,
            name=f"S/R {base_price:.2f}",
        )
    score = cand.score * 0.95 if flipped else cand.score
    if flipped:
        side = "support" if role == "support" else "resistance"
        name = f"S/R {side} (flipped) {base_price:.2f}"
    else:
        name = f"S/R {base_price:.2f}"
    evidence = list(cand.evidence_against)
    if flipped:
        evidence.append(f"role from close: {role}")
    return DrawingCandidate(
        id=cand.id,
        pattern_id=cand.pattern_id,
        style=cand.style,
        score=score,
        swing_ids=cand.swing_ids,
        shapes=cand.shapes,
        evidence_against=evidence,
        invalidation_price=inv,
        break_time=cand.break_time,
        name=name,
    )


def _hs_target_reached(
    cand: DrawingCandidate,
    candles: list[Candle],
    atr: float | None,
    break_t: int,
) -> bool:
    if atr is None or not cand.shapes:
        return False
    shape = cand.shapes[0]
    points = shape.get("points")
    if not isinstance(points, list) or len(points) < 2:
        return False
    p1, p2 = points[0], points[1]
    if not isinstance(p1, dict) or not isinstance(p2, dict):
        return False
    t1, pr1, t2, pr2 = int(p1["time"]), float(p1["price"]), int(p2["time"]), float(p2["price"])
    bullish_break = cand.pattern_id == "inverse_head_and_shoulders"
    for candle in candles:
        if candle.time <= break_t:
            continue
        neck = _line_price_at(t1, pr1, t2, pr2, candle.time)
        if bullish_break and candle.close > neck + 0.5 * atr:
            return True
        if not bullish_break and candle.close < neck - 0.5 * atr:
            return True
    return False


def _candidate_stale(
    cand: DrawingCandidate,
    candles: list[Candle],
    bar_sec: int,
    atr: float | None,
) -> bool:
    if cand.pattern_id not in ("head_and_shoulders", "inverse_head_and_shoulders"):
        return False
    if "pattern completed" not in cand.evidence_against:
        return False
    break_t = cand.break_time or _last_anchor_time(cand)
    if not bar_sec or not break_t:
        return False
    stale_bars = max(5, int(0.15 * len(candles)))
    bars_since = (candles[-1].time - break_t) / bar_sec
    if bars_since > stale_bars:
        return True
    return _hs_target_reached(cand, candles, atr, break_t)


def _line_invalidation_at(
    t1: int,
    p1: float,
    t2: int,
    p2: float,
    at_t: int,
    *,
    side: Literal["below", "above"],
    atr: float,
) -> float:
    line = _line_price_at(t1, p1, t2, p2, at_t)
    buffer = 0.25 * atr
    return line - buffer if side == "below" else line + buffer


def _channel_close_fit(
    candles: list[Candle],
    *,
    hu: ZigZagSwing,
    hl: ZigZagSwing,
    lu: ZigZagSwing,
    ll: ZigZagSwing,
    window_end: int,
    atr: float,
) -> float | None:
    return _triangle_close_fit(candles, hu=hu, hl=hl, lu=lu, ll=ll, window_end=window_end, atr=atr)


def _channel_regime_ok(pattern_id: str, regime: str) -> bool:
    if pattern_id == "channel_up" and regime == "trend_down":
        return False
    if pattern_id == "channel_down" and regime == "trend_up":
        return False
    return True


def _triangle_close_fit(
    candles: list[Candle],
    *,
    hu: ZigZagSwing,
    hl: ZigZagSwing,
    lu: ZigZagSwing,
    ll: ZigZagSwing,
    window_end: int,
    atr: float,
) -> float | None:
    tol = 0.25 * atr
    t_start = max(min(hu.t, hl.t), min(lu.t, ll.t))
    outside = 0
    total = 0
    for candle in candles:
        if candle.time < t_start or candle.time > window_end:
            continue
        upper = _line_price_at(hu.t, hu.price, hl.t, hl.price, candle.time)
        lower = _line_price_at(lu.t, lu.price, ll.t, ll.price, candle.time)
        if upper <= lower:
            return None
        total += 1
        if candle.close > upper + tol or candle.close < lower - tol:
            outside += 1
    if total == 0:
        return None
    if outside / total > 0.10:
        return None
    apex = _lines_apex_time(hu.t, hu.price, hl.t, hl.price, lu.t, lu.price, ll.t, ll.price)
    if apex is None or apex <= window_end:
        return None
    return 1.0 - outside / total


def _trendline_shape(
    *,
    symbol: str,
    interval: Interval,
    name: str,
    p1: tuple[int, float],
    p2: tuple[int, float],
    confidence: float,
) -> dict[str, Any]:
    return {
        "id": _cand_id("tl", name, p1[0], p2[0]),
        "symbol": symbol,
        "interval": interval,
        "kind": "trendline",
        "name": name,
        "status": "preview",
        "source": "agent",
        "confidence": confidence,
        "points": [{"time": p1[0], "price": p1[1]}, {"time": p2[0], "price": p2[1]}],
        "priceLow": None,
        "priceHigh": None,
    }


def _zone_shape(
    *,
    symbol: str,
    interval: Interval,
    name: str,
    t0: int,
    t1: int,
    low: float,
    high: float,
    confidence: float,
) -> dict[str, Any]:
    return {
        "id": _cand_id("zn", name, t0, low, high),
        "symbol": symbol,
        "interval": interval,
        "kind": "zone",
        "name": name,
        "status": "preview",
        "source": "agent",
        "confidence": confidence,
        "points": [{"time": t0, "price": low}, {"time": t1, "price": high}],
        "priceLow": low,
        "priceHigh": high,
    }


def _level_clusters(
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
    window_start: int,
    window_end: int,
) -> list[DrawingCandidate]:
    if not zz or atr is None:
        return []
    price_range = max(z.price for z in zz) - min(z.price for z in zz)
    tol = min(0.25 * atr, 0.01 * price_range) if price_range > 0 else 0.25 * atr
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    out: list[DrawingCandidate] = []
    for swings in (lows, highs):
        if len(swings) < 2:
            continue
        clusters: list[list[ZigZagSwing]] = []
        current: list[ZigZagSwing] = [swings[0]]
        for swing in swings[1:]:
            if abs(swing.price - current[-1].price) <= tol:
                current.append(swing)
            else:
                clusters.append(current)
                current = [swing]
        clusters.append(current)
        for cluster in clusters:
            if len(cluster) < 2:
                continue
            gaps = [
                cluster[i + 1].i - cluster[i].i
                for i in range(len(cluster) - 1)
                if cluster[i + 1].i > cluster[i].i
            ]
            if gaps and min(gaps) < 5:
                continue
            if not anchor_in_play(cluster[-1].t, window_start, window_end):
                continue
            price = sum(s.price for s in cluster) / len(cluster)
            t0, t1 = cluster[0].t, window_end
            band_low = price - 0.1 * atr
            band_high = price + 0.1 * atr
            score = min(0.85, 0.55 + 0.1 * len(cluster))
            cid = _cand_id("sr", cluster[0].side, round(price, 2), t0)
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="support_resistance",
                    style="classic",
                    score=score,
                    swing_ids=[s.id for s in cluster],
                    name=f"S/R {price:.2f}",
                    shapes=[
                        _zone_shape(
                            symbol=symbol,
                            interval=interval,
                            name=f"S/R {price:.2f}",
                            t0=t0,
                            t1=t1,
                            low=band_low,
                            high=band_high,
                            confidence=score,
                        )
                    ],
                    invalidation_price=band_low if cluster[0].side == "low" else band_high,
                    evidence_against=["only 2 touches"] if len(cluster) < 3 else [],
                )
            )
    return out


def _trendlines_from_swings(
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
    bar_sec: int,
    window_end: int,
) -> list[DrawingCandidate]:
    out: list[DrawingCandidate] = []
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    touch_tol = 0.25 * (atr or 1.0)
    for side_swings, label in ((highs, "Resistance trendline"), (lows, "Support trendline")):
        if len(side_swings) < 2:
            continue
        pool = side_swings[-3:] if len(side_swings) >= 3 else side_swings[-2:]
        best: tuple[float, ZigZagSwing, ZigZagSwing] | None = None
        for i in range(len(pool)):
            for j in range(i + 1, len(pool)):
                a, b = pool[i], pool[j]
                span_bars = (b.t - a.t) / bar_sec if bar_sec else 0
                if span_bars < 8:
                    continue
                touches = _trendline_touch_count(side_swings, a.t, a.price, b.t, b.price, touch_tol)
                fit = min(1.0, (touches - 1) / 3.0)
                recency = (b.t - pool[0].t) / max(pool[-1].t - pool[0].t, 1)
                score = max(
                    0.58,
                    _geometry_score(fit=fit, touches=touches, span_bars=span_bars, recency=recency),
                )
                if best is None or score > best[0]:
                    best = (score, a, b)
        if best is None:
            continue
        score, a, b = best
        cid = _cand_id("tl", label, a.t, b.t)
        atr_val = atr or 1.0
        inv_side: Literal["below", "above"] = "below" if "Support" in label else "above"
        inv = _line_invalidation_at(
            a.t, a.price, b.t, b.price, window_end, side=inv_side, atr=atr_val
        )
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="trendline",
                style="classic",
                score=score,
                swing_ids=[a.id, b.id],
                name=label,
                shapes=[
                    _trendline_shape(
                        symbol=symbol,
                        interval=interval,
                        name=label,
                        p1=(a.t, a.price),
                        p2=(b.t, b.price),
                        confidence=score,
                    )
                ],
                invalidation_price=inv,
            )
        )
    return out


def _double_top_bottom(
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
    window_start: int,
    window_end: int,
    bar_sec: int,
) -> list[DrawingCandidate]:
    if atr is None or len(zz) < 4:
        return []
    tol = 0.4 * atr
    out: list[DrawingCandidate] = []
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    for e1_idx, e1 in enumerate(highs):
        e2: ZigZagSwing | None = None
        for candidate in highs[e1_idx + 1 :]:
            if abs(candidate.price - e1.price) > tol:
                continue
            middle = [h for h in highs if e1.t < h.t < candidate.t]
            if any(h.price > max(e1.price, candidate.price) + tol for h in middle):
                continue
            e2 = candidate
            break
        if e2 is None or not anchor_in_play(e2.t, window_start, window_end):
            continue
        if bar_sec and (e2.t - e1.t) / bar_sec < 12:
            continue
        troughs = [z for z in lows if e1.t <= z.t <= e2.t]
        if not troughs:
            continue
        neck = min(t.price for t in troughs)
        middle_highs = [h for h in highs if e1.t < h.t < e2.t]
        if middle_highs and max(h.price for h in middle_highs) > max(e1.price, e2.price) + tol:
            continue
        touches = 2 + len(troughs)
        fit = min(1.0, touches / 4.0)
        score = max(
            0.58,
            _geometry_score(
                fit=fit,
                touches=touches,
                size_atr=abs(e1.price - neck) / atr,
                span_bars=(e2.t - e1.t) / max(window_end - window_start, 1) * 200,
            ),
        )
        cid = _cand_id("dt", e1.t, e2.t)
        neck_shape = _trendline_shape(
            symbol=symbol,
            interval=interval,
            name="Double top neckline",
            p1=(e1.t, neck),
            p2=(e2.t, neck),
            confidence=score,
        )
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="double_top",
                style="classic",
                score=score,
                swing_ids=[e1.id, e2.id] + [t.id for t in troughs[:2]],
                name="Double top",
                shapes=[neck_shape],
                invalidation_price=max(e1.price, e2.price) + 0.25 * atr,
                evidence_against=["only 2 swing touches on tops"],
            )
        )
        break
    for e1_idx, e1 in enumerate(lows):
        e2_low: ZigZagSwing | None = None
        for candidate in lows[e1_idx + 1 :]:
            if abs(candidate.price - e1.price) > tol:
                continue
            middle = [low for low in lows if e1.t < low.t < candidate.t]
            if any(low.price < min(e1.price, candidate.price) - tol for low in middle):
                continue
            e2_low = candidate
            break
        if e2_low is None or not anchor_in_play(e2_low.t, window_start, window_end):
            continue
        if bar_sec and (e2_low.t - e1.t) / bar_sec < 12:
            continue
        peaks = [z for z in highs if e1.t <= z.t <= e2_low.t]
        if not peaks:
            continue
        neck = max(p.price for p in peaks)
        middle_lows = [low for low in lows if e1.t < low.t < e2_low.t]
        if (
            middle_lows
            and min(low.price for low in middle_lows) < min(e1.price, e2_low.price) - tol
        ):
            continue
        touches = 2 + len(peaks)
        fit = min(1.0, touches / 4.0)
        score = max(
            0.58,
            _geometry_score(
                fit=fit,
                touches=touches,
                size_atr=abs(neck - e1.price) / atr,
                span_bars=(e2_low.t - e1.t) / max(window_end - window_start, 1) * 200,
            ),
        )
        cid = _cand_id("db", e1.t, e2_low.t)
        neck_shape = _trendline_shape(
            symbol=symbol,
            interval=interval,
            name="Double bottom neckline",
            p1=(e1.t, neck),
            p2=(e2_low.t, neck),
            confidence=score,
        )
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="double_bottom",
                style="classic",
                score=score,
                swing_ids=[e1.id, e2_low.id] + [p.id for p in peaks[:2]],
                name="Double bottom",
                shapes=[neck_shape],
                invalidation_price=min(e1.price, e2_low.price) - 0.25 * atr,
                evidence_against=["only 2 swing touches on bottoms"],
            )
        )
        break
    return out


def _best_swing_pair(
    swings: list[ZigZagSwing], *, bar_sec: int, min_span_bars: float = 12.0
) -> tuple[ZigZagSwing, ZigZagSwing] | None:
    best: tuple[float, ZigZagSwing, ZigZagSwing] | None = None
    for i in range(len(swings) - 1):
        for j in range(i + 1, len(swings)):
            span = (swings[j].t - swings[i].t) / bar_sec if bar_sec else 0.0
            if span < min_span_bars:
                continue
            if best is None or span > best[0]:
                best = (span, swings[i], swings[j])
    if best is None:
        return None
    return best[1], best[2]


def _rail_is_flat(a: ZigZagSwing, b: ZigZagSwing, *, bar_sec: int, atr: float) -> bool:
    span_bars = abs(b.t - a.t) / bar_sec if bar_sec else 0.0
    if span_bars < 1:
        return True
    slope = (b.price - a.price) / span_bars
    return abs(slope) * span_bars <= 0.5 * atr


def _liquidity_pair(
    swings: list[ZigZagSwing],
    tol: float,
    *,
    symbol: str,
    interval: Interval,
    side: str,
    window_start: int,
    window_end: int,
) -> DrawingCandidate | None:
    best: tuple[ZigZagSwing, ZigZagSwing] | None = None
    for i in range(len(swings)):
        for j in range(i + 1, len(swings)):
            a, b = swings[i], swings[j]
            if abs(a.price - b.price) > tol:
                continue
            if not anchor_in_play(max(a.t, b.t), window_start, window_end):
                continue
            if abs(a.i - b.i) < 5:
                continue
            if best is None or max(a.t, b.t) > max(best[0].t, best[1].t):
                best = (a, b)
    if best is None:
        return None
    a, b = best
    label = "Liquidity highs" if side == "high" else "Liquidity lows"
    cid = _cand_id("liq", a.t, b.t, side)
    level = max(a.price, b.price) if side == "high" else min(a.price, b.price)
    return DrawingCandidate(
        id=cid,
        pattern_id="liquidity",
        style="smc",
        score=0.61,
        swing_ids=[a.id, b.id],
        name=label,
        shapes=[
            _trendline_shape(
                symbol=symbol,
                interval=interval,
                name=label,
                p1=(a.t, a.price),
                p2=(b.t, b.price),
                confidence=0.61,
            )
        ],
        invalidation_price=level,
    )


def _ranges_overlap(t0: int, t1: int, u0: int, u1: int) -> bool:
    return max(t0, u0) <= min(t1, u1)


def _triangle_converges(
    hu: ZigZagSwing,
    hl: ZigZagSwing,
    lu: ZigZagSwing,
    ll: ZigZagSwing,
) -> bool:
    width_start = abs(hu.price - lu.price)
    width_end = abs(hl.price - ll.price)
    if width_start <= 0:
        return False
    return width_end < width_start * 0.9


def _triangles_and_channels(
    candles: list[Candle],
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
    bar_sec: int,
    window_start: int,
    window_end: int,
    regime: str,
) -> list[DrawingCandidate]:
    out: list[DrawingCandidate] = []
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    atr_val = atr or 1.0
    last_close = float(candles[-1].close) if candles else 0.0
    tri_ranked: list[tuple[float, DrawingCandidate]] = []
    if len(highs) >= 2 and len(lows) >= 2:
        for hi in range(len(highs) - 1):
            for hj in range(hi + 1, len(highs)):
                hu, hl = highs[hi], highs[hj]
                high_span = (hl.t - hu.t) / bar_sec if bar_sec else 0
                if high_span < 15:
                    continue
                for li in range(len(lows) - 1):
                    for lj in range(li + 1, len(lows)):
                        lu, ll = lows[li], lows[lj]
                        low_span = (ll.t - lu.t) / bar_sec if bar_sec else 0
                        if low_span < 15:
                            continue
                        if not _ranges_overlap(
                            min(hu.t, hl.t), max(hu.t, hl.t), min(lu.t, ll.t), max(lu.t, ll.t)
                        ):
                            continue
                        flat_top = _rail_is_flat(hu, hl, bar_sec=bar_sec, atr=atr_val)
                        flat_bottom = _rail_is_flat(lu, ll, bar_sec=bar_sec, atr=atr_val)
                        rising_lows = ll.price > lu.price
                        falling_highs = hl.price < hu.price
                        pid = ""
                        label = ""
                        if flat_top and rising_lows:
                            pid, label = "ascending_triangle", "Ascending triangle"
                        elif flat_bottom and falling_highs:
                            pid, label = "descending_triangle", "Descending triangle"
                        elif rising_lows and falling_highs:
                            pid, label = "symmetrical_triangle", "Symmetrical triangle"
                        if not pid:
                            continue
                        if not anchor_in_play(hl.t, window_start, window_end):
                            continue
                        if not anchor_in_play(ll.t, window_start, window_end):
                            continue
                        fit = _triangle_close_fit(
                            candles,
                            hu=hu,
                            hl=hl,
                            lu=lu,
                            ll=ll,
                            window_end=window_end,
                            atr=atr_val,
                        )
                        if fit is None:
                            continue
                        recency = (max(hl.t, ll.t) - window_start) / max(
                            window_end - window_start, 1
                        )
                        score = _geometry_score(
                            fit=fit,
                            touches=4,
                            span_bars=min(high_span, low_span),
                            recency=recency,
                            size_atr=1.0,
                        )
                        cid = _cand_id("tri", pid, hu.t, hl.t, lu.t, ll.t)
                        if pid == "ascending_triangle":
                            inv = _line_invalidation_at(
                                lu.t,
                                lu.price,
                                ll.t,
                                ll.price,
                                window_end,
                                side="below",
                                atr=atr_val,
                            )
                        elif pid == "descending_triangle":
                            inv = _line_invalidation_at(
                                hu.t,
                                hu.price,
                                hl.t,
                                hl.price,
                                window_end,
                                side="above",
                                atr=atr_val,
                            )
                        else:
                            inv_low = _line_invalidation_at(
                                lu.t,
                                lu.price,
                                ll.t,
                                ll.price,
                                window_end,
                                side="below",
                                atr=atr_val,
                            )
                            inv_high = _line_invalidation_at(
                                hu.t,
                                hu.price,
                                hl.t,
                                hl.price,
                                window_end,
                                side="above",
                                atr=atr_val,
                            )
                            inv = (
                                inv_low
                                if abs(last_close - inv_low) < abs(last_close - inv_high)
                                else inv_high
                            )
                        upper = _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name=f"{label} upper",
                            p1=(hu.t, hu.price),
                            p2=(hl.t, hl.price),
                            confidence=score,
                        )
                        lower = _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name=f"{label} lower",
                            p1=(lu.t, lu.price),
                            p2=(ll.t, ll.price),
                            confidence=score,
                        )
                        tri_ranked.append(
                            (
                                recency,
                                DrawingCandidate(
                                    id=cid,
                                    pattern_id=pid,
                                    style="classic",
                                    score=score,
                                    swing_ids=[hu.id, hl.id, lu.id, ll.id],
                                    name=label,
                                    shapes=[upper, lower],
                                    invalidation_price=inv,
                                ),
                            )
                        )
        tri_ranked.sort(key=lambda item: item[0], reverse=True)
        used_swings: set[str] = set()
        for _rec, cand in tri_ranked[:3]:
            if used_swings.intersection(cand.swing_ids):
                continue
            used_swings.update(cand.swing_ids)
            out.append(cand)
    if len(highs) >= 2 and len(lows) >= 2:
        high_pair = _best_swing_pair(highs[-4:], bar_sec=bar_sec) or (highs[-2], highs[-1])
        low_pair = _best_swing_pair(lows[-4:], bar_sec=bar_sec) or (lows[-2], lows[-1])
        hu, hl = high_pair
        lu, ll = low_pair
        rising_lows = ll.price > lu.price
        falling_highs = hl.price < hu.price
        if len(highs) >= 2 and len(lows) >= 2:
            ch_up = rising_lows and hu.price < hl.price and lu.price < ll.price
            ch_down = falling_highs and hu.price > hl.price and lu.price > ll.price
            width = abs((hu.price + hl.price) / 2 - (lu.price + ll.price) / 2)
            if ch_up or ch_down:
                if width < 1.5 * atr_val:
                    ch_up = ch_down = False
                elif bar_sec:
                    high_slope = (hl.price - hu.price) / max((hl.t - hu.t) / bar_sec, 1.0)
                    low_slope = (ll.price - lu.price) / max((ll.t - lu.t) / bar_sec, 1.0)
                    if abs(high_slope - low_slope) > 0.35 * atr_val:
                        ch_up = ch_down = False
            if ch_up or ch_down:
                pid = "channel_up" if ch_up else "channel_down"
                if not _channel_regime_ok(pid, regime):
                    ch_up = ch_down = False
                fit = _channel_close_fit(
                    candles,
                    hu=hu,
                    hl=hl,
                    lu=lu,
                    ll=ll,
                    window_end=window_end,
                    atr=atr_val,
                )
                if fit is None:
                    ch_up = ch_down = False
            if ch_up or ch_down:
                pid = "channel_up" if ch_up else "channel_down"
                score = max(
                    0.58,
                    _geometry_score(
                        fit=fit if fit is not None else 0.5,
                        touches=4,
                        span_bars=(ll.t - lu.t) / bar_sec if bar_sec else 0,
                        size_atr=width / atr_val if atr_val else 1.0,
                    ),
                )
                cid = _cand_id("ch", pid, hu.t, ll.t)
                if ch_up:
                    ch_inv = _line_invalidation_at(
                        lu.t,
                        lu.price,
                        ll.t,
                        ll.price,
                        window_end,
                        side="below",
                        atr=atr_val,
                    )
                else:
                    ch_inv = _line_invalidation_at(
                        hu.t,
                        hu.price,
                        hl.t,
                        hl.price,
                        window_end,
                        side="above",
                        atr=atr_val,
                    )
                out.append(
                    DrawingCandidate(
                        id=cid,
                        pattern_id=pid,
                        style="classic",
                        score=score,
                        swing_ids=[hu.id, hl.id, lu.id, ll.id],
                        name="Channel (high rail)" if ch_up else "Channel (low rail)",
                        invalidation_price=ch_inv,
                        shapes=[
                            _trendline_shape(
                                symbol=symbol,
                                interval=interval,
                                name="Channel high rail",
                                p1=(hu.t, hu.price),
                                p2=(hl.t, hl.price),
                                confidence=score,
                            ),
                            _trendline_shape(
                                symbol=symbol,
                                interval=interval,
                                name="Channel low rail",
                                p1=(lu.t, lu.price),
                                p2=(ll.t, ll.price),
                                confidence=score,
                            ),
                        ],
                    )
                )
    return out


def _neckline_end_after_break(
    candles: list[Candle],
    *,
    la: ZigZagSwing,
    lb: ZigZagSwing,
    shoulder_t: int,
    bar_sec: int,
    break_below: bool,
    atr: float | None,
) -> tuple[int, float, bool, int | None]:
    end_t = shoulder_t + 3 * bar_sec if bar_sec else shoulder_t
    end_price = _line_price_at(la.t, la.price, lb.t, lb.price, end_t)
    broken = False
    break_t: int | None = None
    tol = _price_tolerance(candles, atr)
    prev_time = shoulder_t
    for candle in candles:
        if candle.time <= shoulder_t:
            continue
        neck = _line_price_at(la.t, la.price, lb.t, lb.price, candle.time)
        if break_below and candle.close < neck:
            broken = True
            break_t = candle.time
            if prev_time < candle.time:
                end_t = prev_time
                end_price = _line_price_at(la.t, la.price, lb.t, lb.price, end_t)
            else:
                end_t = candle.time
                end_price = _wick_safe_price(candle, float(candle.low), tol)
            break
        if not break_below and candle.close > neck:
            broken = True
            break_t = candle.time
            if prev_time < candle.time:
                end_t = prev_time
                end_price = _line_price_at(la.t, la.price, lb.t, lb.price, end_t)
            else:
                end_t = candle.time
                end_price = _wick_safe_price(candle, float(candle.high), tol)
            break
        prev_time = candle.time
    return end_t, end_price, broken, break_t


def _head_shoulders(
    candles: list[Candle],
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
    window_start: int,
    window_end: int,
    last_close: float,
    bar_sec: int,
) -> list[DrawingCandidate]:
    if atr is None or len(zz) < 5:
        return []
    highs = [z for z in zz if z.side == "high"]
    if len(highs) < 3:
        return []
    tol = 0.35 * atr
    best: DrawingCandidate | None = None
    best_recency = -1.0
    for idx in range(len(highs) - 2):
        left, head, right = highs[idx], highs[idx + 1], highs[idx + 2]
        if head.price <= left.price or head.price <= right.price:
            continue
        if abs(left.price - right.price) > tol:
            continue
        if not anchor_in_play(right.t, window_start, window_end):
            continue
        between_lows = [z for z in zz if z.side == "low" and left.t <= z.t <= right.t]
        if len(between_lows) < 2:
            continue
        la, lb = between_lows[0], between_lows[-1]
        if abs(la.price - lb.price) > tol:
            continue
        neck_at_right = _line_price_at(la.t, la.price, lb.t, lb.price, right.t)
        end_t, end_price, broken, break_t = _neckline_end_after_break(
            candles,
            la=la,
            lb=lb,
            shoulder_t=right.t,
            bar_sec=bar_sec,
            break_below=True,
            atr=atr,
        )
        evidence: list[str] = []
        if not broken and last_close >= neck_at_right:
            evidence.append("neckline not broken")
        if broken:
            evidence.append("pattern completed")
        recency = (right.t - window_start) / max(window_end - window_start, 1)
        touches = 3 + len(between_lows)
        fit = min(1.0, touches / 5.0)
        score = max(
            0.58,
            _geometry_score(
                fit=fit,
                touches=touches,
                size_atr=(head.price - min(la.price, lb.price)) / atr,
                recency=recency,
            ),
        )
        if broken:
            score = min(score, 0.72)
        neck_end = end_price
        cid = _cand_id("hs", left.t, head.t, right.t)
        cand = DrawingCandidate(
            id=cid,
            pattern_id="head_and_shoulders",
            style="classic",
            score=score,
            swing_ids=[left.id, head.id, right.id] + [z.id for z in between_lows[:2]],
            name="Head and shoulders",
            shapes=[
                _trendline_shape(
                    symbol=symbol,
                    interval=interval,
                    name="H&S neckline",
                    p1=(la.t, la.price),
                    p2=(end_t, neck_end),
                    confidence=score,
                )
            ],
            invalidation_price=head.price + 0.25 * atr,
            break_time=break_t,
            evidence_against=evidence,
        )
        if recency > best_recency:
            best_recency = recency
            best = cand
    return [best] if best is not None else []


def _inverse_head_shoulders(
    candles: list[Candle],
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
    window_start: int,
    window_end: int,
    last_close: float,
    bar_sec: int,
) -> list[DrawingCandidate]:
    if atr is None or len(zz) < 5:
        return []
    lows = [z for z in zz if z.side == "low"]
    if len(lows) < 3:
        return []
    tol = 0.35 * atr
    best: DrawingCandidate | None = None
    best_recency = -1.0
    for idx in range(len(lows) - 2):
        left, head, right = lows[idx], lows[idx + 1], lows[idx + 2]
        if head.price >= left.price or head.price >= right.price:
            continue
        if abs(left.price - right.price) > tol:
            continue
        if not anchor_in_play(right.t, window_start, window_end):
            continue
        between_highs = [z for z in zz if z.side == "high" and left.t <= z.t <= right.t]
        if len(between_highs) < 2:
            continue
        ha, hb = between_highs[0], between_highs[-1]
        if abs(ha.price - hb.price) > tol:
            continue
        neck_at_right = _line_price_at(ha.t, ha.price, hb.t, hb.price, right.t)
        end_t, end_price, broken, break_t = _neckline_end_after_break(
            candles,
            la=ha,
            lb=hb,
            shoulder_t=right.t,
            bar_sec=bar_sec,
            break_below=False,
            atr=atr,
        )
        evidence: list[str] = []
        if not broken and last_close <= neck_at_right:
            evidence.append("neckline not broken")
        if broken:
            evidence.append("pattern completed")
        recency = (right.t - window_start) / max(window_end - window_start, 1)
        touches = 3 + len(between_highs)
        fit = min(1.0, touches / 5.0)
        score = max(
            0.58,
            _geometry_score(
                fit=fit,
                touches=touches,
                size_atr=(max(ha.price, hb.price) - head.price) / atr,
                recency=recency,
            ),
        )
        if broken:
            score = min(score, 0.72)
        neck_end = end_price
        cid = _cand_id("ihs", left.t, head.t, right.t)
        cand = DrawingCandidate(
            id=cid,
            pattern_id="inverse_head_and_shoulders",
            style="classic",
            score=score,
            swing_ids=[left.id, head.id, right.id] + [z.id for z in between_highs[:2]],
            name="Inverse H&S",
            shapes=[
                _trendline_shape(
                    symbol=symbol,
                    interval=interval,
                    name="Inverse H&S neckline",
                    p1=(ha.t, ha.price),
                    p2=(end_t, neck_end),
                    confidence=score,
                )
            ],
            invalidation_price=head.price - 0.25 * atr,
            break_time=break_t,
            evidence_against=evidence,
        )
        if recency > best_recency:
            best_recency = recency
            best = cand
    return [best] if best is not None else []


def _fib_retracement(
    candles: list[Candle],
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
) -> list[DrawingCandidate]:
    if atr is None or len(zz) < 2 or len(candles) < 2:
        return []
    window_end = candles[-1].time
    half_t = candles[len(candles) // 2].time
    leg: tuple[ZigZagSwing, ZigZagSwing] | None = None
    for i in range(len(zz) - 1, 0, -1):
        a, b = zz[i - 1], zz[i]
        impulse = b.price - a.price
        if abs(impulse) < 3.0 * atr:
            continue
        if b.t < half_t:
            continue
        leg = (a, b)
        break
    if leg is None:
        return []
    a, b = leg
    impulse = b.price - a.price
    score = _geometry_score(size_atr=abs(impulse) / atr, recency=0.7, touches=2)
    cid = _cand_id("fib", a.t, b.t)
    levels: list[dict[str, Any]] = []
    t_left, t_right = a.t, window_end
    for ratio, label in ((0.382, "Fib 0.382"), (0.5, "Fib 0.5"), (0.618, "Fib 0.618")):
        price = b.price - impulse * ratio
        levels.append(
            _trendline_shape(
                symbol=symbol,
                interval=interval,
                name=label,
                p1=(t_right, price),
                p2=(t_left, price),
                confidence=score,
            )
        )
    pocket_low = b.price - impulse * 0.618
    pocket_high = b.price - impulse * 0.5
    levels.append(
        _zone_shape(
            symbol=symbol,
            interval=interval,
            name="Fib pocket 0.5–0.618",
            t0=t_left,
            t1=t_right,
            low=min(pocket_low, pocket_high),
            high=max(pocket_low, pocket_high),
            confidence=score,
        )
    )
    return [
        DrawingCandidate(
            id=cid,
            pattern_id="fib_retracement",
            style="classic",
            score=score,
            swing_ids=[a.id, b.id],
            name="Fib retracement",
            shapes=levels,
        )
    ]


def _fvg_mitigated(
    candles: list[Candle],
    start_index: int,
    *,
    low: float,
    high: float,
    bullish: bool,
) -> bool:
    for candle in candles[start_index + 1 :]:
        if bullish and candle.low <= low:
            return True
        if not bullish and candle.high >= high:
            return True
    return False


def _pick_fvg(
    candles: list[Candle],
    atr: float,
    *,
    symbol: str,
    interval: Interval,
) -> list[DrawingCandidate]:
    min_gap = 0.1 * atr
    newest_half = max(2, len(candles) // 2)
    best_bull: tuple[int, float, int, int, int, float, float] | None = None
    best_bear: tuple[int, float, int, int, int, float, float] | None = None
    for i in range(len(candles) - 1, 1, -1):
        if i < len(candles) - newest_half:
            continue
        c0, mid, c2 = candles[i - 2], candles[i - 1], candles[i]
        if mid.close > mid.open and c0.high < c2.low:
            gap = c2.low - c0.high
            if gap < min_gap:
                continue
            if _fvg_mitigated(candles, i, low=c0.high, high=c2.low, bullish=True):
                continue
            if best_bull is None or i > best_bull[0]:
                best_bull = (i, gap, c0.time, mid.time, c2.time, c0.high, c2.low)
        if mid.close < mid.open and c0.low > c2.high:
            gap = c0.low - c2.high
            if gap < min_gap:
                continue
            if _fvg_mitigated(candles, i, low=c2.high, high=c0.low, bullish=False):
                continue
            if best_bear is None or i > best_bear[0]:
                best_bear = (i, gap, c0.time, mid.time, c2.time, c2.high, c0.low)
    out: list[DrawingCandidate] = []
    last_t = candles[-1].time
    if best_bull is not None:
        _, gap, t0, tm, t2, low, high = best_bull
        score = min(0.75, 0.55 + gap / atr)
        cid = _cand_id("fvg", t0, tm, t2, "bull")
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="fvg",
                style="smc",
                score=score,
                swing_ids=[],
                name="Bullish FVG",
                shapes=[
                    _zone_shape(
                        symbol=symbol,
                        interval=interval,
                        name="Bullish FVG",
                        t0=t0,
                        t1=last_t,
                        low=low,
                        high=high,
                        confidence=score,
                    )
                ],
                invalidation_price=low,
            )
        )
    if best_bear is not None:
        _, gap, t0, tm, t2, low, high = best_bear
        score = min(0.75, 0.55 + gap / atr)
        cid = _cand_id("fvg", t0, tm, t2, "bear")
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="fvg",
                style="smc",
                score=score,
                swing_ids=[],
                name="Bearish FVG",
                shapes=[
                    _zone_shape(
                        symbol=symbol,
                        interval=interval,
                        name="Bearish FVG",
                        t0=t0,
                        t1=last_t,
                        low=low,
                        high=high,
                        confidence=score,
                    )
                ],
                invalidation_price=high,
            )
        )
    return out


def _four_swing_structure(zz: list[ZigZagSwing]) -> list[ZigZagSwing] | None:
    if len(zz) < 4:
        return None
    last = zz[-4:]
    sides = [z.side for z in last]
    if sides != ["low", "high", "low", "high"] and sides != ["high", "low", "high", "low"]:
        return None
    return last


def _smc_detectors(
    candles: list[Candle],
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
) -> list[DrawingCandidate]:
    if len(candles) < 5 or atr is None:
        return []
    out: list[DrawingCandidate] = []
    last = candles[-1]
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    structure = _four_swing_structure(zz)
    half_idx = len(candles) // 2

    def _close_break_in_newest_half(level: float, bullish: bool) -> bool:
        for candle in candles[half_idx:]:
            if bullish and candle.close > level:
                return True
            if not bullish and candle.close < level:
                return True
        return False

    if structure and structure[0].side == "low":
        l1, h1, l2, h2 = structure
        if l1.price < l2.price < h1.price < h2.price and _close_break_in_newest_half(
            h1.price, True
        ):
            score = 0.7
            cid = _cand_id("bos", h1.t, "bull")
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="bos",
                    style="smc",
                    score=score,
                    swing_ids=[l1.id, l2.id, h1.id, h2.id],
                    name="BOS bullish",
                    shapes=[
                        _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name="BOS level",
                            p1=(l1.t, h1.price),
                            p2=(last.time, h1.price),
                            confidence=score,
                        )
                    ],
                    invalidation_price=h1.price - 0.25 * atr,
                )
            )
        if h2.price > h1.price > l1.price > l2.price:
            score = 0.66
            cid = _cand_id("choch", h2.t, "bull")
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="choch",
                    style="smc",
                    score=score,
                    swing_ids=[l1.id, h1.id, l2.id, h2.id],
                    name="CHoCH bullish",
                    shapes=[
                        _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name="CHoCH bullish",
                            p1=(h1.t, h1.price),
                            p2=(last.time, h1.price),
                            confidence=score,
                        )
                    ],
                    invalidation_price=l2.price,
                )
            )
    if structure and structure[0].side == "high":
        h1, l1, h2, l2 = structure
        if h1.price > h2.price > l1.price > l2.price and _close_break_in_newest_half(
            l1.price, False
        ):
            score = 0.7
            cid = _cand_id("bos", l1.t, "bear")
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="bos",
                    style="smc",
                    score=score,
                    swing_ids=[h1.id, l1.id, h2.id, l2.id],
                    name="BOS bearish",
                    shapes=[
                        _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name="BOS level",
                            p1=(h1.t, l1.price),
                            p2=(last.time, l1.price),
                            confidence=score,
                        )
                    ],
                    invalidation_price=l1.price + 0.25 * atr,
                )
            )
        if l2.price < l1.price < h1.price < h2.price:
            score = 0.66
            cid = _cand_id("choch", l2.t, "bear")
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="choch",
                    style="smc",
                    score=score,
                    swing_ids=[h1.id, l1.id, h2.id, l2.id],
                    name="CHoCH bearish",
                    shapes=[
                        _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name="CHoCH bearish",
                            p1=(l1.t, l1.price),
                            p2=(last.time, l1.price),
                            confidence=score,
                        )
                    ],
                    invalidation_price=h2.price,
                )
            )
    out.extend(_pick_fvg(candles, atr, symbol=symbol, interval=interval))
    # Order block: last opposing candle before impulse
    if len(candles) >= 3:
        prev, cur = candles[-3], candles[-2]
        if cur.close > prev.high:
            cid = _cand_id("ob", prev.time)
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="order_block",
                    style="smc",
                    score=0.6,
                    swing_ids=[],
                    name="Bullish order block",
                    shapes=[
                        _zone_shape(
                            symbol=symbol,
                            interval=interval,
                            name="Order block",
                            t0=prev.time,
                            t1=cur.time,
                            low=prev.low,
                            high=prev.high,
                            confidence=0.6,
                        )
                    ],
                    invalidation_price=prev.low - 0.25 * atr,
                )
            )
        if cur.close < prev.low:
            cid = _cand_id("ob", prev.time, "bear")
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="order_block",
                    style="smc",
                    score=0.6,
                    swing_ids=[],
                    name="Bearish order block",
                    shapes=[
                        _zone_shape(
                            symbol=symbol,
                            interval=interval,
                            name="Order block",
                            t0=prev.time,
                            t1=cur.time,
                            low=prev.low,
                            high=prev.high,
                            confidence=0.6,
                        )
                    ],
                    invalidation_price=prev.high + 0.25 * atr,
                )
            )
    price_range = max(c.high for c in candles) - min(c.low for c in candles)
    liq_tol = max(0.01 * price_range, 0.15 * atr)
    ws, we = candles[0].time, candles[-1].time
    liq_high = _liquidity_pair(
        highs,
        liq_tol,
        symbol=symbol,
        interval=interval,
        side="high",
        window_start=ws,
        window_end=we,
    )
    if liq_high is not None:
        out.append(liq_high)
    liq_low = _liquidity_pair(
        lows, liq_tol, symbol=symbol, interval=interval, side="low", window_start=ws, window_end=we
    )
    if liq_low is not None:
        out.append(liq_low)
    return out


def build_candidate_catalog(
    candles: list[Candle],
    *,
    symbol: str,
    interval: Interval,
) -> CandidateCatalog:
    regime = detect_regime(candles, interval)
    atr = wilder_atr(candles)
    zz = zigzag_swings(candles, interval, atr_mult=zigzag_mult(interval))
    if len(zz) < 3:
        zz = fractals_as_zigzag(candles, interval)
    bar_sec = bar_seconds(interval)
    window_start = candles[0].time
    window_end = candles[-1].time
    candidates: list[DrawingCandidate] = []
    candidates.extend(
        _trendlines_from_swings(
            zz,
            atr,
            symbol=symbol,
            interval=interval,
            bar_sec=bar_sec,
            window_end=window_end,
        )
    )
    candidates.extend(
        _level_clusters(
            zz,
            atr,
            symbol=symbol,
            interval=interval,
            window_start=window_start,
            window_end=window_end,
        )
    )
    candidates.extend(
        _double_top_bottom(
            zz,
            atr,
            symbol=symbol,
            interval=interval,
            window_start=window_start,
            window_end=window_end,
            bar_sec=bar_sec,
        )
    )
    last_close = float(candles[-1].close)
    candidates.extend(
        _triangles_and_channels(
            candles,
            zz,
            atr,
            symbol=symbol,
            interval=interval,
            bar_sec=bar_sec,
            window_start=window_start,
            window_end=window_end,
            regime=str(regime),
        )
    )
    candidates.extend(
        _head_shoulders(
            candles,
            zz,
            atr,
            symbol=symbol,
            interval=interval,
            window_start=window_start,
            window_end=window_end,
            last_close=last_close,
            bar_sec=bar_sec,
        )
    )
    candidates.extend(
        _inverse_head_shoulders(
            candles,
            zz,
            atr,
            symbol=symbol,
            interval=interval,
            window_start=window_start,
            window_end=window_end,
            last_close=last_close,
            bar_sec=bar_sec,
        )
    )
    candidates.extend(_fib_retracement(candles, zz, atr, symbol=symbol, interval=interval))
    candidates.extend(_smc_detectors(candles, zz, atr, symbol=symbol, interval=interval))
    gate_window = DrawingWindow(
        candles=candles,
        interval=interval,
        window_start=window_start,
        allowed_times={c.time for c in candles},
    )
    raw_candidate_count = len(candidates)
    prefilter_dropped: list[PrefilterDrop] = []
    processed: list[DrawingCandidate] = []
    from cryptosignal_copilot.pattern_invalidation import (
        pattern_broken,
        triangle_breakout_completed,
    )

    for cand in candidates:
        cand = _sr_role_from_last_close(cand, candles)
        if _candidate_stale(cand, candles, bar_sec, atr):
            prefilter_dropped.append(
                PrefilterDrop(candidate_id=cand.id, pattern_id=cand.pattern_id, reason="stale")
            )
            continue
        if triangle_breakout_completed(cand, candles, atr, zz):
            prefilter_dropped.append(
                PrefilterDrop(candidate_id=cand.id, pattern_id=cand.pattern_id, reason="completed")
            )
            continue
        if (
            pattern_broken(cand, candles, atr, zz).broken
            and cand.pattern_id != "support_resistance"
        ):
            prefilter_dropped.append(
                PrefilterDrop(
                    candidate_id=cand.id, pattern_id=cand.pattern_id, reason="invalidated"
                )
            )
            continue
        processed.append(cand)
    candidates = processed
    kept: list[DrawingCandidate] = []
    for cand in candidates:
        gated_shapes = []
        for shape in cand.shapes:
            tagged = dict(shape)
            tagged["_candidate_id"] = cand.id
            gated_shapes.append(tagged)
        reason = prefilter_candidate(gated_shapes, gate_window)
        if reason:
            prefilter_dropped.append(
                PrefilterDrop(candidate_id=cand.id, pattern_id=cand.pattern_id, reason=reason)
            )
        else:
            kept.append(cand)
    candidates = sorted(kept, key=lambda c: c.score, reverse=True)
    return CandidateCatalog(
        symbol=symbol,
        interval=interval,
        regime=regime,
        atr=atr,
        zigzag=zz,
        candidates=candidates,
        raw_candidate_count=raw_candidate_count,
        prefilter_dropped=prefilter_dropped,
    )


def patterns_for_style(style: str) -> frozenset[str]:
    if style == "smc":
        return SMC_PATTERNS
    if style == "classic":
        return CLASSIC_PATTERNS
    return frozenset()
