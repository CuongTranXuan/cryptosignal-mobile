"""Broken head-and-shoulders must pass gate and reach the wire."""

from __future__ import annotations

from cryptosignal_copilot.vi_text import EV_PATTERN_COMPLETED

from unittest.mock import patch

from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.chart_real_path import run_real_path
from cryptosignal_copilot.drawing_intent import CandidateDrawingIntent
from cryptosignal_copilot.gate_policy import prefilter_candidate
from cryptosignal_copilot.drawing_gate import DrawingWindow
from tests.eval.test_chart_replay import _load_fixture


@patch("cryptosignal_copilot.candidates._candidate_stale", return_value=False)
def test_broken_head_shoulders_passes_prefilter_and_wire(_mock_stale: object) -> None:
    symbol, interval, candles = _load_fixture("ethusdt_4h_200.json")
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    hs = [c for c in catalog.candidates if c.pattern_id == "head_and_shoulders"]
    assert hs, "expected H&S candidate in catalog when staleness disabled"
    window = DrawingWindow(
        candles=candles,
        interval=interval,  # type: ignore[arg-type]
        window_start=candles[0].time,
        allowed_times={c.time for c in candles},
    )
    tagged = [{**shape, "_candidate_id": hs[0].id} for shape in hs[0].shapes]
    assert prefilter_candidate(tagged, window) is None
    intents = [CandidateDrawingIntent(candidate_id=hs[0].id)]
    wire, metrics = run_real_path(
        catalog,
        candles,
        symbol=symbol,
        interval=interval,
        style="classic",
        intents=intents,
    )
    assert wire
    assert metrics.gate_dropped == 0
    assert EV_PATTERN_COMPLETED in hs[0].evidence_against
