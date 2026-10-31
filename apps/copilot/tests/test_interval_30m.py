"""30m is a first-class interval: enum, aliases, candle fetch, fractal K, projection k
cap, HTF mapping, ATR/zigzag tables, and the full detector + gate path."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from cryptosignal_copilot.analyze_prep import _HTF_INTERVAL, _htf_context
from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.chart_real_path import run_real_path
from cryptosignal_copilot.drawing_gate import effective_project_bars, table_project_bars
from cryptosignal_copilot.features import (
    bar_seconds,
    fractal_radius,
    htf_summary,
    zigzag_mult,
)
from cryptosignal_copilot.klines import fetch_klines
from cryptosignal_copilot.schema import INTERVALS, AnalyzeRequest, Candle, _coerce_interval

FIXTURE = Path(__file__).parent / "fixtures" / "ohlcv" / "btcusdt_1h_200.json"
ROW = [1710000000000, "100", "110", "90", "105", "12.5", 1710001799999, "0", 1, "0", "0", "0"]


def _candles_30m() -> list[Candle]:
    """The 1h replay fixture re-timed onto a 30m grid (same OHLC, 1800s spacing)."""
    rows = json.loads(FIXTURE.read_text())["candles"]
    start = int(rows[0]["time"])
    return [Candle.model_validate({**r, "time": start + i * 1800}) for i, r in enumerate(rows)]


def test_30m_tables():
    assert "30m" in INTERVALS
    assert bar_seconds("30m") == 1800
    assert fractal_radius("30m") == fractal_radius("15m") == 2
    assert table_project_bars("30m") == 27
    assert effective_project_bars("30m") == 27
    assert zigzag_mult("30m") == zigzag_mult("15m")
    assert _HTF_INTERVAL["30m"] == "4h"
    assert htf_summary(_candles_30m(), "30m")["bars"] == 50  # 4-bar buckets, like 15m


@pytest.mark.parametrize("raw", ["30m", "30min", "30M"])
def test_30m_aliases_normalize(raw):
    assert _coerce_interval(raw, "1h") == "30m"


def test_analyze_request_accepts_30m():
    candles = _candles_30m()
    req = AnalyzeRequest.model_validate(
        {
            "symbol": "BTCUSDT",
            "interval": "30m",
            "from": candles[0].time,
            "to": candles[-1].time,
            "closedCandles": [c.model_dump() for c in candles],
            "existingShapes": [],
            "prompt": "x",
        }
    )
    assert req.interval == "30m"


@pytest.mark.asyncio
async def test_fetch_klines_passes_30m_to_binance():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["interval"] == "30m"
        return httpx.Response(200, json=[ROW])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        candles = await fetch_klines("BTCUSDT", "30m", client=client)
    assert candles[0].time == 1710000000


@pytest.mark.asyncio
async def test_30m_htf_context_uses_closed_4h_bars(monkeypatch):
    seen: list[str] = []
    end_open = 1788566400  # a 4h boundary

    async def fake_fetch(symbol, interval, limit=120, end_time=None, **kwargs):
        seen.append(interval)
        rows = [
            Candle(time=end_open - (20 - i) * 14400, open=1, high=2, low=0.5, close=1.5, volume=1)
            for i in range(21)
        ]
        return rows

    monkeypatch.setattr("cryptosignal_copilot.analyze_prep.fetch_klines", fake_fetch)
    ctx = await _htf_context("BTCUSDT", "30m", end_open, ltf_interval="30m")
    assert seen == ["4h"]
    assert ctx is not None and ctx["interval"] == "4h"
    # The 4h bar opening at end_open is still forming at the 30m close: excluded.
    assert ctx["last_closed_open_time"] == end_open - 14400


def test_30m_detector_and_gate_path_produces_valid_shapes():
    candles = _candles_30m()
    catalog = build_candidate_catalog(candles, symbol="BTCUSDT", interval="30m")
    assert catalog.candidates
    shapes, _ = run_real_path(catalog, candles, symbol="BTCUSDT", interval="30m", style="classic")
    assert shapes
    last = candles[-1].time
    for shape in shapes:
        assert shape["interval"] == "30m"
        for point in shape["points"]:
            if point["time"] > last:
                k = (point["time"] - last) / 1800
                assert k == int(k) and 1 <= k <= 27
