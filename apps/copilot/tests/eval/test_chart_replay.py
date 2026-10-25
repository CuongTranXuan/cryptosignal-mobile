"""Replay detector + gate metrics on frozen Binance OHLCV fixtures."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from cryptosignal_copilot.candidates import CLASSIC_PATTERNS, SMC_PATTERNS, build_candidate_catalog
from cryptosignal_copilot.drawing_gate import DrawingWindow
from cryptosignal_copilot.drawing_intent import (
    CandidateDrawingIntent,
    MAX_DRAWING_INTENTS,
    enrich_resolved_shapes,
    resolve_drawing_intents,
)
from cryptosignal_copilot.gate_policy import split_gate_and_cap_drops
from cryptosignal_copilot.schema import Candle, filter_preview_details

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "ohlcv"

TRIANGLE_PATTERNS = frozenset({"ascending_triangle", "descending_triangle", "symmetrical_triangle"})
DOUBLE_PATTERNS = frozenset({"double_top", "double_bottom"})

FAMILY_BY_PATTERN: dict[str, str] = {
    **{p: "triangle" for p in TRIANGLE_PATTERNS},
    **{p: "double" for p in DOUBLE_PATTERNS},
    "fib_retracement": "fib",
    "liquidity": "liquidity",
    "trendline": "trendline",
    "channel_up": "channel",
    "channel_down": "channel",
    "head_and_shoulders": "hs",
    "inverse_head_and_shoulders": "hs",
    "support_resistance": "sr",
    "bos": "smc",
    "choch": "smc",
    "fvg": "smc",
    "order_block": "smc",
}


def _load_fixture(name: str) -> tuple[str, str, list[Candle]]:
    payload = json.loads((FIXTURE_DIR / name).read_text())
    symbol = str(payload["symbol"])
    interval = str(payload["interval"])
    candles = [Candle.model_validate(row) for row in payload["candles"]]
    return symbol, interval, candles


def _prefilter_metrics(catalog) -> dict[str, float | int | dict[str, int]]:
    raw = catalog.raw_candidate_count or len(catalog.candidates) + len(catalog.prefilter_dropped)
    dropped = len(catalog.prefilter_dropped)
    rate = dropped / raw if raw else 0.0
    by_pattern = Counter(d.pattern_id for d in catalog.prefilter_dropped)
    by_family: Counter[str] = Counter()
    raw_by_family: Counter[str] = Counter()
    for cand in catalog.candidates:
        raw_by_family[FAMILY_BY_PATTERN.get(cand.pattern_id, cand.pattern_id)] += 1
    for drop in catalog.prefilter_dropped:
        by_family[FAMILY_BY_PATTERN.get(drop.pattern_id, drop.pattern_id)] += 1
    for drop in catalog.prefilter_dropped:
        raw_by_family[FAMILY_BY_PATTERN.get(drop.pattern_id, drop.pattern_id)] += 1
    family_rates: dict[str, float] = {}
    for family, total in raw_by_family.items():
        family_rates[family] = by_family[family] / total if total else 0.0
    return {
        "raw_candidates": raw,
        "prefilter_dropped": dropped,
        "prefilter_drop_rate": rate,
        "prefilter_by_pattern": dict(by_pattern),
        "prefilter_family_rates": family_rates,
    }


def _gate_metrics(
    candles: list[Candle], symbol: str, interval: str, catalog
) -> dict[str, float | int | dict[str, int]]:
    pattern_counts = Counter(c.pattern_id for c in catalog.candidates)
    classic_count = sum(1 for c in catalog.candidates if c.style == "classic")
    intents = [CandidateDrawingIntent(candidate_id=c.id) for c in catalog.candidates]
    shapes, _ = resolve_drawing_intents(intents, catalog, max_intents=MAX_DRAWING_INTENTS)
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
    cap_shape_loss = (
        (input_count - len(valid) - len(gate_drops)) / input_count if input_count else 0.0
    )
    return {
        "candidates": len(catalog.candidates),
        "classic_candidates": classic_count,
        "shapes_in": input_count,
        "shapes_out": len(valid),
        "gate_dropped": len(gate_drops),
        "cap_dropped": len(cap_drops),
        "gate_drop_rate": gate_drop_rate,
        "cap_shape_loss_rate": cap_shape_loss,
        "gate_reasons": dict(Counter(reason for _, reason in gate_drops)),
        "patterns": dict(pattern_counts),
    }


def test_replay_fixtures_sixteen_windows():
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    assert len(fixtures) == 16


def test_replay_prefilter_and_gate_rates():
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    assert fixtures, "missing OHLCV fixtures"
    symbols: set[str] = set()
    intervals: set[str] = set()
    suite_patterns: Counter[str] = Counter()
    suite_pf: Counter[str] = Counter()
    suite_raw = 0
    suite_pf_dropped = 0
    for path in fixtures:
        symbol, interval, candles = _load_fixture(path.name)
        symbols.add(symbol)
        intervals.add(interval)
        catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
        pf = _prefilter_metrics(catalog)
        gate = _gate_metrics(candles, symbol, interval, catalog)
        suite_patterns.update(gate["patterns"])
        suite_pf.update(pf["prefilter_by_pattern"])
        suite_raw += int(pf["raw_candidates"])
        suite_pf_dropped += int(pf["prefilter_dropped"])
        assert gate["classic_candidates"] >= 1, f"{path.name} has no classic candidates"
        assert pf["prefilter_drop_rate"] <= 0.10, (
            f"{path.name} prefilter_drop_rate={pf['prefilter_drop_rate']:.3f} "
            f"by_pattern={pf['prefilter_by_pattern']}"
        )
        assert gate["gate_drop_rate"] <= 0.02, (
            f"{path.name} gate_drop_rate={gate['gate_drop_rate']:.3f} "
            f"reasons={gate['gate_reasons']} cap={gate['cap_dropped']}"
        )
    overall_pf = suite_pf_dropped / suite_raw if suite_raw else 0.0
    assert overall_pf <= 0.10, f"suite prefilter_drop_rate={overall_pf:.3f} drops={dict(suite_pf)}"
    assert symbols == {"BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"}
    assert intervals == {"15m", "1h", "4h", "1d"}
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
        catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
        pf = _prefilter_metrics(catalog)
        gate = _gate_metrics(candles, symbol, interval, catalog)
        rows.append(
            f"{path.name}: raw={pf['raw_candidates']} pf_drop={pf['prefilter_dropped']}"
            f"({pf['prefilter_drop_rate']:.1%}) cand={gate['candidates']} classic={gate['classic_candidates']} "
            f"shapes={gate['shapes_in']} gate_drop={gate['gate_dropped']}({gate['gate_drop_rate']:.1%}) "
            f"cap={gate['cap_dropped']} out={gate['shapes_out']}"
        )
    print("\n".join(rows))
