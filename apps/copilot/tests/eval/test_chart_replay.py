"""Replay detector + gate metrics on frozen Binance OHLCV fixtures."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from cryptosignal_copilot.candidates import CLASSIC_PATTERNS, SMC_PATTERNS, build_candidate_catalog
from cryptosignal_copilot.drawing_gate import DrawingWindow
from cryptosignal_copilot.drawing_intent import (
    CandidateDrawingIntent,
    enrich_resolved_shapes,
    resolve_drawing_intents,
)
from cryptosignal_copilot.gate_policy import split_gate_and_cap_drops
from cryptosignal_copilot.schema import Candle, filter_preview_details

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "ohlcv"

TRIANGLE_PATTERNS = frozenset(
    {"ascending_triangle", "descending_triangle", "symmetrical_triangle"}
)
DOUBLE_PATTERNS = frozenset({"double_top", "double_bottom"})


def _load_fixture(name: str) -> tuple[str, str, list[Candle]]:
    payload = json.loads((FIXTURE_DIR / name).read_text())
    symbol = str(payload["symbol"])
    interval = str(payload["interval"])
    candles = [Candle.model_validate(row) for row in payload["candles"]]
    return symbol, interval, candles


def _all_candidate_metrics(
    candles: list[Candle], symbol: str, interval: str
) -> dict[str, float | int | dict[str, int]]:
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    pattern_counts = Counter(c.pattern_id for c in catalog.candidates)
    intents = [CandidateDrawingIntent(candidate_id=c.id) for c in catalog.candidates]
    shapes, _ = resolve_drawing_intents(intents, catalog, max_intents=999)
    last_close = float(candles[-1].close)
    shapes = enrich_resolved_shapes(shapes, catalog, last_close=last_close)
    allowed_times = {c.time for c in candles}
    window = DrawingWindow(
        candles=candles,
        interval=interval,  # type: ignore[arg-type]
        window_start=candles[0].time,
        allowed_times=allowed_times,
    )
    valid, dropped = filter_preview_details(
        shapes,
        allowed_times,
        symbol=symbol,
        interval=interval,  # type: ignore[arg-type]
        window=window,
    )
    gate_drops, cap_drops = split_gate_and_cap_drops(dropped)
    input_count = len(shapes)
    gate_drop_rate = len(gate_drops) / input_count if input_count else 0.0
    return {
        "candidates": len(catalog.candidates),
        "shapes_in": input_count,
        "shapes_out": len(valid),
        "gate_dropped": len(gate_drops),
        "cap_dropped": len(cap_drops),
        "gate_drop_rate": gate_drop_rate,
        "gate_reasons": dict(Counter(reason for _, reason in gate_drops)),
        "patterns": dict(pattern_counts),
    }


def test_replay_fixtures_count():
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    assert len(fixtures) >= 8


def test_replay_all_candidates_gate_drop_rate():
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    assert fixtures, "missing OHLCV fixtures"
    symbols = set()
    intervals = set()
    suite_patterns: Counter[str] = Counter()
    for path in fixtures:
        symbol, interval, candles = _load_fixture(path.name)
        symbols.add(symbol)
        intervals.add(interval)
        metrics = _all_candidate_metrics(candles, symbol, interval)
        suite_patterns.update(metrics["patterns"])
        assert metrics["candidates"] > 0
        assert metrics["gate_drop_rate"] <= 0.02, (
            f"{path.name} gate_drop_rate={metrics['gate_drop_rate']:.3f} "
            f"reasons={metrics['gate_reasons']} cap={metrics['cap_dropped']}"
        )
    assert symbols >= {"BTCUSDT", "ETHUSDT", "SOLUSDT"}
    assert intervals >= {"15m", "1h", "4h"}
    assert suite_patterns["fvg"] >= 1
    assert suite_patterns["bos"] >= 1
    assert suite_patterns["liquidity"] >= 1
    assert sum(suite_patterns[p] for p in TRIANGLE_PATTERNS) >= 1
    assert sum(suite_patterns[p] for p in DOUBLE_PATTERNS) >= 1


def test_replay_report_metrics(capsys):
    """Emit per-fixture metrics for CI logs (not a pass/fail gate)."""
    rows = []
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        symbol, interval, candles = _load_fixture(path.name)
        m = _all_candidate_metrics(candles, symbol, interval)
        rows.append(
            f"{path.name}: cand={m['candidates']} shapes={m['shapes_in']} "
            f"gate_drop={m['gate_dropped']}({m['gate_drop_rate']:.1%}) "
            f"cap={m['cap_dropped']} out={m['shapes_out']}"
        )
    print("\n".join(rows))
