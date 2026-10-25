"""Rule-based drawing candidates with detector scores."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Literal

from cryptosignal_copilot.chart_regime import Regime, detect_regime
from cryptosignal_copilot.drawing_gate import DrawingWindow, apply_preview_gate
from cryptosignal_copilot.gate_policy import anchor_in_play, candidate_passes_gate
from cryptosignal_copilot.features import (
    ZigZagSwing,
    bar_seconds,
    fractals_as_zigzag,
    wilder_atr,
    zigzag_mult,
    zigzag_swings,
)
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
    name: str = ""


@dataclass
class CandidateCatalog:
    symbol: str
    interval: Interval
    regime: Regime
    atr: float | None
    zigzag: list[ZigZagSwing]
    candidates: list[DrawingCandidate]

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
    *,
    symbol: str,
    interval: Interval,
    bar_sec: int,
) -> list[DrawingCandidate]:
    out: list[DrawingCandidate] = []
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    for side_swings, label in ((highs, "Resistance trendline"), (lows, "Support trendline")):
        if len(side_swings) < 2:
            continue
        a, b = side_swings[-2], side_swings[-1]
        span_bars = (b.t - a.t) / bar_sec if bar_sec else 0
        if span_bars < 8:
            continue
        score = min(0.8, 0.55 + span_bars / 100)
        cid = _cand_id("tl", label, a.t, b.t)
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
            )
        )
    return out


def _double_top_bottom(
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
) -> list[DrawingCandidate]:
    if atr is None or len(zz) < 4:
        return []
    tol = 0.4 * atr
    out: list[DrawingCandidate] = []
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    if len(highs) >= 2:
        h1, h2 = highs[-2], highs[-1]
        if abs(h1.price - h2.price) <= tol:
            between_lows = [z for z in zz if z.side == "low" and h1.t <= z.t <= h2.t]
            if len(between_lows) < 2:
                between_lows = lows[-2:] if len(lows) >= 2 else []
            score = 0.72
            cid = _cand_id("dt", h1.t, h2.t)
            if len(between_lows) >= 2:
                la, lb = between_lows[0], between_lows[-1]
                neck_shape = _trendline_shape(
                    symbol=symbol,
                    interval=interval,
                    name="Double top neckline",
                    p1=(la.t, la.price),
                    p2=(lb.t, lb.price),
                    confidence=score,
                )
            else:
                neck_price = min(h1.price, h2.price) - atr
                neck_shape = _trendline_shape(
                    symbol=symbol,
                    interval=interval,
                    name="Double top neckline",
                    p1=(h1.t, neck_price),
                    p2=(h2.t, neck_price),
                    confidence=score,
                )
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="double_top",
                    style="classic",
                    score=score,
                    swing_ids=[h1.id, h2.id] + [z.id for z in between_lows[:2]],
                    name="Double top",
                    shapes=[neck_shape],
                    invalidation_price=max(h1.price, h2.price) + 0.25 * atr,
                    evidence_against=["only 2 swing touches on tops"],
                )
            )
    if len(lows) >= 2:
        l1, l2 = lows[-2], lows[-1]
        if abs(l1.price - l2.price) <= tol:
            between_highs = [z for z in zz if z.side == "high" and l1.t <= z.t <= l2.t]
            if len(between_highs) < 2:
                between_highs = highs[-2:] if len(highs) >= 2 else []
            score = 0.72
            cid = _cand_id("db", l1.t, l2.t)
            if len(between_highs) >= 2:
                ha, hb = between_highs[0], between_highs[-1]
                neck_shape = _trendline_shape(
                    symbol=symbol,
                    interval=interval,
                    name="Double bottom neckline",
                    p1=(ha.t, ha.price),
                    p2=(hb.t, hb.price),
                    confidence=score,
                )
            else:
                neck_price = max(l1.price, l2.price) + atr
                neck_shape = _trendline_shape(
                    symbol=symbol,
                    interval=interval,
                    name="Double bottom neckline",
                    p1=(l1.t, neck_price),
                    p2=(l2.t, neck_price),
                    confidence=score,
                )
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="double_bottom",
                    style="classic",
                    score=score,
                    swing_ids=[l1.id, l2.id] + [z.id for z in between_highs[:2]],
                    name="Double bottom",
                    shapes=[neck_shape],
                    invalidation_price=min(l1.price, l2.price) - 0.25 * atr,
                    evidence_against=["only 2 swing touches on bottoms"],
                )
            )
    return out


def _rail_is_flat(
    a: ZigZagSwing, b: ZigZagSwing, *, bar_sec: int, atr: float
) -> bool:
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
) -> DrawingCandidate | None:
    best: tuple[ZigZagSwing, ZigZagSwing] | None = None
    for i in range(len(swings)):
        for j in range(i + 1, len(swings)):
            a, b = swings[i], swings[j]
            if abs(a.price - b.price) > tol:
                continue
            if best is None or max(a.t, b.t) > max(best[0].t, best[1].t):
                best = (a, b)
    if best is None:
        return None
    a, b = best
    label = "Liquidity highs" if side == "high" else "Liquidity lows"
    cid = _cand_id("liq", a.t, b.t, side)
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
    )


def _triangles_and_channels(
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
    bar_sec: int,
) -> list[DrawingCandidate]:
    out: list[DrawingCandidate] = []
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    atr_val = atr or 1.0
    best_tri: tuple[float, str, str, ZigZagSwing, ZigZagSwing, ZigZagSwing, ZigZagSwing] | None = (
        None
    )
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
                        flat_top = _rail_is_flat(hu, hl, bar_sec=bar_sec, atr=atr_val)
                        flat_bottom = _rail_is_flat(lu, ll, bar_sec=bar_sec, atr=atr_val)
                        rising_lows = ll.price > lu.price
                        falling_highs = hl.price < hu.price
                        pid = ""
                        score = 0.0
                        label = ""
                        if flat_top and rising_lows:
                            pid, label, score = "ascending_triangle", "Ascending triangle", 0.68
                        elif flat_bottom and falling_highs:
                            pid, label, score = "descending_triangle", "Descending triangle", 0.68
                        elif rising_lows and falling_highs:
                            pid, label, score = (
                                "symmetrical_triangle",
                                "Symmetrical triangle",
                                0.65,
                            )
                        if pid and (best_tri is None or score > best_tri[0]):
                            best_tri = (score, pid, label, hu, hl, lu, ll)
        if best_tri is not None:
            score, pid, type_label, hu, hl, lu, ll = best_tri
            cid = _cand_id("tri", pid, hu.t, ll.t)
            upper = _trendline_shape(
                symbol=symbol,
                interval=interval,
                name=f"{type_label} upper",
                p1=(hu.t, hu.price),
                p2=(hl.t, hl.price),
                confidence=score,
            )
            lower = _trendline_shape(
                symbol=symbol,
                interval=interval,
                name=f"{type_label} lower",
                p1=(lu.t, lu.price),
                p2=(ll.t, ll.price),
                confidence=score,
            )
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id=pid,
                    style="classic",
                    score=score,
                    swing_ids=[hu.id, hl.id, lu.id, ll.id],
                    name=type_label,
                    shapes=[upper, lower],
                )
            )
    if len(highs) >= 2 and len(lows) >= 2:
        hu, hl = highs[-2], highs[-1]
        lu, ll = lows[-2], lows[-1]
        rising_lows = ll.price > lu.price
        falling_highs = hl.price < hu.price
        if len(highs) >= 2 and len(lows) >= 2:
            ch_up = rising_lows and hu.price < hl.price and lu.price < ll.price
            ch_down = falling_highs and hu.price > hl.price and lu.price > ll.price
            if ch_up or ch_down:
                pid = "channel_up" if ch_up else "channel_down"
                score = 0.66
                cid = _cand_id("ch", pid, hu.t, ll.t)
                out.append(
                    DrawingCandidate(
                        id=cid,
                        pattern_id=pid,
                        style="classic",
                        score=score,
                        swing_ids=[hu.id, hl.id, lu.id, ll.id],
                        name="Channel (high rail)" if ch_up else "Channel (low rail)",
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


def _head_shoulders(
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
) -> list[DrawingCandidate]:
    if atr is None or len(zz) < 5:
        return []
    highs = [z for z in zz if z.side == "high"]
    if len(highs) < 3:
        return []
    left, head, right = highs[-3], highs[-2], highs[-1]
    tol = 0.35 * atr
    if head.price <= left.price or head.price <= right.price:
        return []
    if abs(left.price - right.price) > tol:
        return []
    score = 0.7
    cid = _cand_id("hs", left.t, head.t, right.t)
    neck = min(left.price, right.price) - atr
    return [
        DrawingCandidate(
            id=cid,
            pattern_id="head_and_shoulders",
            style="classic",
            score=score,
            swing_ids=[left.id, head.id, right.id],
            name="Head and shoulders",
            shapes=[
                _trendline_shape(
                    symbol=symbol,
                    interval=interval,
                    name="H&S neckline",
                    p1=(left.t, neck),
                    p2=(right.t, neck),
                    confidence=score,
                )
            ],
            invalidation_price=head.price + 0.25 * atr,
        )
    ]


def _fib_retracement(
    zz: list[ZigZagSwing],
    atr: float | None,
    *,
    symbol: str,
    interval: Interval,
) -> list[DrawingCandidate]:
    if atr is None or len(zz) < 2:
        return []
    a, b = zz[-2], zz[-1]
    impulse = b.price - a.price
    if abs(impulse) < 1.5 * atr:
        return []
    score = 0.64
    cid = _cand_id("fib", a.t, b.t)
    levels = []
    for ratio, label in ((0.382, "Fib 0.382"), (0.5, "Fib 0.5"), (0.618, "Fib 0.618")):
        price = b.price - impulse * ratio if impulse > 0 else b.price - impulse * ratio
        levels.append(
            _trendline_shape(
                symbol=symbol,
                interval=interval,
                name=label,
                p1=(b.t, price),
                p2=(a.t, price),
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
    best_bull: tuple[int, float, int, int, float, float] | None = None
    best_bear: tuple[int, float, int, int, float, float] | None = None
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
                best_bull = (i, gap, c0.time, c2.time, c0.high, c2.low)
        if mid.close < mid.open and c0.low > c2.high:
            gap = c0.low - c2.high
            if gap < min_gap:
                continue
            if _fvg_mitigated(candles, i, low=c2.high, high=c0.low, bullish=False):
                continue
            if best_bear is None or i > best_bear[0]:
                best_bear = (i, gap, c0.time, c2.time, c2.high, c0.low)
    out: list[DrawingCandidate] = []
    last_t = candles[-1].time
    if best_bull is not None:
        _, gap, t0, _t1, low, high = best_bull
        score = min(0.75, 0.55 + gap / atr)
        cid = _cand_id("fvg", last_t, "bull")
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
        _, gap, t0, _t1, low, high = best_bear
        score = min(0.75, 0.55 + gap / atr)
        cid = _cand_id("fvg", last_t, "bear")
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
    newest_half_start = candles[-max(1, len(candles) // 2)].time
    if structure and structure[0].side == "low":
        l1, h1, l2, h2 = structure
        if l1.price < l2.price < h1.price < h2.price and last.close > h1.price:
            if last.time >= newest_half_start:
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
                                p1=(h1.t, h1.price),
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
        if h1.price > h2.price > l1.price > l2.price and last.close < l1.price:
            if last.time >= newest_half_start:
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
                                p1=(l1.t, l1.price),
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
                )
            )
    price_range = max(c.high for c in candles) - min(c.low for c in candles)
    liq_tol = max(0.01 * price_range, 0.15 * atr)
    liq_high = _liquidity_pair(highs, liq_tol, symbol=symbol, interval=interval, side="high")
    if liq_high is not None:
        out.append(liq_high)
    liq_low = _liquidity_pair(lows, liq_tol, symbol=symbol, interval=interval, side="low")
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
    candidates: list[DrawingCandidate] = []
    candidates.extend(
        _trendlines_from_swings(zz, symbol=symbol, interval=interval, bar_sec=bar_sec)
    )
    window_start = candles[0].time
    window_end = candles[-1].time
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
    candidates.extend(_double_top_bottom(zz, atr, symbol=symbol, interval=interval))
    candidates.extend(
        _triangles_and_channels(zz, atr, symbol=symbol, interval=interval, bar_sec=bar_sec)
    )
    candidates.extend(_head_shoulders(zz, atr, symbol=symbol, interval=interval))
    candidates.extend(_fib_retracement(zz, atr, symbol=symbol, interval=interval))
    candidates.extend(_smc_detectors(candles, zz, atr, symbol=symbol, interval=interval))
    # inverse H&S on lows
    lows = [z for z in zz if z.side == "low"]
    if atr and len(lows) >= 3:
        left, head, right = lows[-3], lows[-2], lows[-1]
        tol = 0.35 * atr
        if (
            head.price < left.price
            and head.price < right.price
            and abs(left.price - right.price) <= tol
        ):
            score = 0.7
            cid = _cand_id("ihs", left.t, head.t, right.t)
            neck = max(left.price, right.price) + atr
            candidates.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="inverse_head_and_shoulders",
                    style="classic",
                    score=score,
                    swing_ids=[left.id, head.id, right.id],
                    name="Inverse H&S",
                    shapes=[
                        _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name="Inverse H&S neckline",
                            p1=(left.t, neck),
                            p2=(right.t, neck),
                            confidence=score,
                        )
                    ],
                    invalidation_price=head.price - 0.25 * atr,
                )
            )
    gate_window = DrawingWindow(
        candles=candles,
        interval=interval,
        window_start=window_start,
        allowed_times={c.time for c in candles},
    )
    candidates = [c for c in candidates if candidate_passes_gate(c.shapes, gate_window)]
    candidates.sort(key=lambda c: c.score, reverse=True)
    # Drop shapes that fail when all catalog shapes are gated together (e.g. false triangle pairing).
    staged = [dict(shape) for cand in candidates for shape in cand.shapes]
    if staged:
        kept, batch_dropped = apply_preview_gate(staged, gate_window)
        drop_ids = {shape_id for shape_id, reason in batch_dropped if reason != "cap"}
        if drop_ids:
            filtered: list[DrawingCandidate] = []
            for cand in candidates:
                shape_ids = {
                    str(shape.get("id", "")) for shape in cand.shapes if str(shape.get("id", ""))
                }
                if shape_ids & drop_ids:
                    continue
                filtered.append(cand)
            candidates = filtered
    return CandidateCatalog(
        symbol=symbol,
        interval=interval,
        regime=regime,
        atr=atr,
        zigzag=zz,
        candidates=candidates,
    )


def patterns_for_style(style: str) -> frozenset[str]:
    if style == "smc":
        return SMC_PATTERNS
    if style == "classic":
        return CLASSIC_PATTERNS
    return frozenset()
