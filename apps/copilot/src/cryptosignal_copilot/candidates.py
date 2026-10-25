"""Rule-based drawing candidates with detector scores."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Literal

from cryptosignal_copilot.chart_regime import Regime, detect_regime
from cryptosignal_copilot.features import (
    ZigZagSwing,
    bar_seconds,
    fractals_as_zigzag,
    wilder_atr,
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
) -> list[DrawingCandidate]:
    if not zz or atr is None:
        return []
    tol = 0.35 * atr
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    out: list[DrawingCandidate] = []
    for side, swings in (("support_resistance", lows), ("support_resistance", highs)):
        if len(swings) < 2:
            continue
        price = sum(s.price for s in swings[-3:]) / min(3, len(swings[-3:]))
        cluster = [s for s in swings if abs(s.price - price) <= tol]
        if len(cluster) < 2:
            continue
        t0, t1 = cluster[0].t, cluster[-1].t
        band_low = price - tol * 0.5
        band_high = price + tol * 0.5
        score = min(0.85, 0.55 + 0.1 * len(cluster))
        cid = _cand_id("sr", side, round(price, 2), t0)
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
                invalidation_price=band_low if swings[0].side == "low" else band_high,
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
            score = 0.72
            cid = _cand_id("dt", h1.t, h2.t)
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="double_top",
                    style="classic",
                    score=score,
                    swing_ids=[h1.id, h2.id],
                    name="Double top",
                    shapes=[
                        _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name="Double top neckline",
                            p1=(h1.t, min(h1.price, h2.price) - atr),
                            p2=(h2.t, min(h1.price, h2.price) - atr),
                            confidence=score,
                        )
                    ],
                    invalidation_price=max(h1.price, h2.price) + 0.25 * atr,
                )
            )
    if len(lows) >= 2:
        l1, l2 = lows[-2], lows[-1]
        if abs(l1.price - l2.price) <= tol:
            score = 0.72
            cid = _cand_id("db", l1.t, l2.t)
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="double_bottom",
                    style="classic",
                    score=score,
                    swing_ids=[l1.id, l2.id],
                    name="Double bottom",
                    shapes=[
                        _trendline_shape(
                            symbol=symbol,
                            interval=interval,
                            name="Double bottom neckline",
                            p1=(l1.t, max(l1.price, l2.price) + atr),
                            p2=(l2.t, max(l1.price, l2.price) + atr),
                            confidence=score,
                        )
                    ],
                    invalidation_price=min(l1.price, l2.price) - 0.25 * atr,
                )
            )
    return out


def _triangles_and_channels(
    zz: list[ZigZagSwing],
    *,
    symbol: str,
    interval: Interval,
    bar_sec: int,
) -> list[DrawingCandidate]:
    out: list[DrawingCandidate] = []
    highs = [z for z in zz if z.side == "high"]
    lows = [z for z in zz if z.side == "low"]
    if len(highs) >= 2 and len(lows) >= 2:
        hu, hl = highs[-2], highs[-1]
        lu, ll = lows[-2], lows[-1]
        flat_top = abs(hu.price - hl.price) / max(hl.price, 1e-9) < 0.004
        flat_bottom = abs(lu.price - ll.price) / max(ll.price, 1e-9) < 0.004
        rising_lows = ll.price > lu.price
        falling_highs = hl.price < hu.price
        span = (ll.t - lu.t) / bar_sec if bar_sec else 0
        if span >= 15:
            if flat_top and rising_lows:
                pid, label = "ascending_triangle", "Ascending triangle upper"
                score = 0.68
            elif flat_bottom and falling_highs:
                pid, label = "descending_triangle", "Descending triangle lower"
                score = 0.68
            elif rising_lows and falling_highs:
                pid, label = "symmetrical_triangle", "Symmetrical triangle"
                label = "Symmetrical triangle upper"
                score = 0.65
            else:
                pid = ""
            if pid:
                cid = _cand_id("tri", pid, hu.t, ll.t)
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
                out.append(
                    DrawingCandidate(
                        id=cid,
                        pattern_id=pid,
                        style="classic",
                        score=score,
                        swing_ids=[hu.id, hl.id, lu.id, ll.id],
                        name=label,
                        shapes=[upper, lower],
                    )
                )
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
                        name="Channel upper" if ch_up else "Channel lower",
                        shapes=[
                            _trendline_shape(
                                symbol=symbol,
                                interval=interval,
                                name="Channel upper",
                                p1=(hu.t, hu.price),
                                p2=(hl.t, hl.price),
                                confidence=score,
                            ),
                            _trendline_shape(
                                symbol=symbol,
                                interval=interval,
                                name="Channel lower",
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
    # BOS / CHoCH
    if highs and last.close > highs[-1].price:
        score = 0.7
        cid = _cand_id("bos", highs[-1].t)
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="bos",
                style="smc",
                score=score,
                swing_ids=[highs[-1].id],
                name="BOS bullish",
                shapes=[
                    _trendline_shape(
                        symbol=symbol,
                        interval=interval,
                        name="BOS level",
                        p1=(highs[-1].t, highs[-1].price),
                        p2=(last.time, highs[-1].price),
                        confidence=score,
                    )
                ],
                invalidation_price=highs[-1].price - 0.25 * atr,
            )
        )
    if lows and last.close < lows[-1].price:
        score = 0.7
        cid = _cand_id("bos", lows[-1].t, "bear")
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="bos",
                style="smc",
                score=score,
                swing_ids=[lows[-1].id],
                name="BOS bearish",
                shapes=[
                    _trendline_shape(
                        symbol=symbol,
                        interval=interval,
                        name="BOS level",
                        p1=(lows[-1].t, lows[-1].price),
                        p2=(last.time, lows[-1].price),
                        confidence=score,
                    )
                ],
                invalidation_price=lows[-1].price + 0.25 * atr,
            )
        )
    if (
        len(highs) >= 2 and last.close < highs[-2].price and last.close > lows[-1].price
        if lows
        else False
    ):
        cid = _cand_id("choch", last.time)
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="choch",
                style="smc",
                score=0.66,
                swing_ids=[highs[-1].id],
                name="CHoCH",
                shapes=[
                    _trendline_shape(
                        symbol=symbol,
                        interval=interval,
                        name="CHoCH",
                        p1=(highs[-2].t, highs[-2].price),
                        p2=(last.time, highs[-2].price),
                        confidence=0.66,
                    )
                ],
            )
        )
    # FVG (3-bar)
    for i in range(2, len(candles)):
        c0, c2 = candles[i - 2], candles[i]
        if c0.high < c2.low:
            low, high = c0.high, c2.low
            cid = _cand_id("fvg", c2.time, "bull")
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="fvg",
                    style="smc",
                    score=0.62,
                    swing_ids=[],
                    name="Bullish FVG",
                    shapes=[
                        _zone_shape(
                            symbol=symbol,
                            interval=interval,
                            name="Bullish FVG",
                            t0=c0.time,
                            t1=c2.time,
                            low=low,
                            high=high,
                            confidence=0.62,
                        )
                    ],
                )
            )
            break
        if c0.low > c2.high:
            low, high = c2.high, c0.low
            cid = _cand_id("fvg", c2.time, "bear")
            out.append(
                DrawingCandidate(
                    id=cid,
                    pattern_id="fvg",
                    style="smc",
                    score=0.62,
                    swing_ids=[],
                    name="Bearish FVG",
                    shapes=[
                        _zone_shape(
                            symbol=symbol,
                            interval=interval,
                            name="Bearish FVG",
                            t0=c0.time,
                            t1=c2.time,
                            low=low,
                            high=high,
                            confidence=0.62,
                        )
                    ],
                )
            )
            break
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
    # Liquidity: equal highs
    if len(highs) >= 2 and abs(highs[-1].price - highs[-2].price) <= 0.2 * atr:
        cid = _cand_id("liq", highs[-1].t)
        out.append(
            DrawingCandidate(
                id=cid,
                pattern_id="liquidity",
                style="smc",
                score=0.61,
                swing_ids=[highs[-1].id, highs[-2].id],
                name="Liquidity highs",
                shapes=[
                    _trendline_shape(
                        symbol=symbol,
                        interval=interval,
                        name="Liquidity",
                        p1=(highs[-2].t, highs[-2].price),
                        p2=(highs[-1].t, highs[-1].price),
                        confidence=0.61,
                    )
                ],
            )
        )
    return out


def build_candidate_catalog(
    candles: list[Candle],
    *,
    symbol: str,
    interval: Interval,
) -> CandidateCatalog:
    regime = detect_regime(candles)
    atr = wilder_atr(candles)
    zz = zigzag_swings(candles, interval)
    if len(zz) < 3:
        zz = fractals_as_zigzag(candles, interval)
    bar_sec = bar_seconds(interval)
    candidates: list[DrawingCandidate] = []
    candidates.extend(
        _trendlines_from_swings(zz, symbol=symbol, interval=interval, bar_sec=bar_sec)
    )
    candidates.extend(_level_clusters(zz, atr, symbol=symbol, interval=interval))
    candidates.extend(_double_top_bottom(zz, atr, symbol=symbol, interval=interval))
    candidates.extend(
        _triangles_and_channels(zz, symbol=symbol, interval=interval, bar_sec=bar_sec)
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
                )
            )
    candidates.sort(key=lambda c: c.score, reverse=True)
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
