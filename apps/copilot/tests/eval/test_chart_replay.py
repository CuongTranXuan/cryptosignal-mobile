"""Replay detector + gate metrics on frozen Binance OHLCV fixtures."""

from __future__ import annotations

import json
from pathlib import Path

from cryptosignal_copilot.candidates import CLASSIC_PATTERNS, SMC_PATTERNS, build_candidate_catalog
from cryptosignal_copilot.drawing_gate import DrawingWindow
from cryptosignal_copilot.drawing_intent import (
    CandidateDrawingIntent,
    enrich_resolved_shapes,
    resolve_drawing_intents,
)
from cryptosignal_copilot.schema import Candle, filter_preview_details

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "ohlcv"


def _load_fixture(name: str) -> tuple[str, str, list[Candle]]:
    payload = json.loads((FIXTURE_DIR / name).read_text())
    symbol = str(payload["symbol"])
    interval = str(payload["interval"])
    candles = [Candle.model_validate(row) for row in payload["candles"]]
    return symbol, interval, candles


def _intents_within_shape_budget(catalog, max_shapes: int = 6) -> list[CandidateDrawingIntent]:
    intents: list[CandidateDrawingIntent] = []
    used = 0
    for cand in catalog.candidates:
        need = len(cand.shapes)
        if used + need > max_shapes:
            continue
        intents.append(CandidateDrawingIntent(candidate_id=cand.id))
        used += need
    return intents


def _gate_metrics(candles: list[Candle], symbol: str, interval: str) -> dict[str, float | int]:
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    intents = _intents_within_shape_budget(catalog)
    shapes, _ = resolve_drawing_intents(intents, catalog)
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
    input_count = len(shapes)
    drop_rate = len(dropped) / input_count if input_count else 0.0
    families_classic = {
        c.pattern_id for c in catalog.candidates if c.pattern_id in CLASSIC_PATTERNS
    }
    families_smc = {c.pattern_id for c in catalog.candidates if c.pattern_id in SMC_PATTERNS}
    return {
        "candidates": len(catalog.candidates),
        "shapes_in": input_count,
        "shapes_out": len(valid),
        "dropped": len(dropped),
        "drop_rate": drop_rate,
        "classic_families": len(families_classic),
        "smc_families": len(families_smc),
    }


def test_replay_gate_drop_rate_on_binance_fixtures():
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    assert fixtures, "missing OHLCV fixtures"
    for path in fixtures:
        symbol, interval, candles = _load_fixture(path.name)
        metrics = _gate_metrics(candles, symbol, interval)
        assert metrics["candidates"] > 0
        assert metrics["classic_families"] > 0 or metrics["smc_families"] > 0
        assert metrics["drop_rate"] <= 0.02, f"{path.name} drop_rate={metrics['drop_rate']:.3f}"
