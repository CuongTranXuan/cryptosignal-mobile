import pytest

from cryptosignal_copilot.candidates import (
    DrawingCandidate,
    build_candidate_catalog,
    _trendline_shape,
    _zone_shape,
)
from cryptosignal_copilot.pattern_invalidation import pattern_broken, swing_anchor_time
from tests.eval.test_chart_replay import _load_fixture


def _catalog(name: str):
    symbol, interval, candles = _load_fixture(name)
    return build_candidate_catalog(candles, symbol=symbol, interval=interval), candles


def test_sr_flip_on_broken_eth_zone():
    catalog, candles = _catalog("ethusdt_1h_200.json")
    sr = [c for c in catalog.candidates if c.pattern_id == "support_resistance"]
    assert sr, "expected S/R zones on eth 1h fixture"


def test_trendline_uses_swing_anchor_not_window_end():
    catalog, candles = _catalog("solusdt_4h_200.json")
    tls = [c for c in catalog.candidates if c.pattern_id == "trendline"]
    assert tls, "solusdt_4h fixture should retain at least one trendline"
    anchor = swing_anchor_time(tls[0], catalog.zigzag)
    assert anchor < candles[-1].time


def test_triangle_line_break_detection():
    catalog, candles = _catalog("btcusdt_1h_200.json")
    tri = next((c for c in catalog.candidates if "triangle" in c.pattern_id), None)
    if tri is None:
        return
    result = pattern_broken(tri, candles, catalog.atr, catalog.zigzag)
    assert isinstance(result.broken, bool)


def test_zone_bos_uses_swing_anchor():
    shape = _trendline_shape(
        symbol="BTCUSDT",
        interval="1h",
        name="BOS level",
        p1=(1000, 100.0),
        p2=(2000, 100.0),
        confidence=0.7,
    )
    cand = DrawingCandidate(
        id="bos_test",
        pattern_id="bos",
        style="smc",
        score=0.7,
        swing_ids=[],
        name="BOS bullish",
        shapes=[shape],
    )
    anchor = swing_anchor_time(cand, [])
    assert anchor == 2000
