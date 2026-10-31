"""Replay detector + real agent preview path on frozen Binance OHLCV fixtures."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.candidates import (
    _line_price_at,
    _triangle_close_fit,
)
from cryptosignal_copilot.chart_real_path import run_real_path, simulate_llm_top_intents
from cryptosignal_copilot.drawing_intent import total_shape_cost
from cryptosignal_copilot.drawing_gate import MAX_SHAPES
from cryptosignal_copilot.schema import Candle

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
    invalidated = [d for d in catalog.prefilter_dropped if d.reason == "invalidated"]
    gate_drops = [d for d in catalog.prefilter_dropped if d.reason != "invalidated"]
    rate = len(gate_drops) / raw if raw else 0.0
    by_pattern = Counter(d.pattern_id for d in gate_drops)
    inv_by_family = Counter(FAMILY_BY_PATTERN.get(d.pattern_id, d.pattern_id) for d in invalidated)
    return {
        "raw_candidates": raw,
        "prefilter_dropped": len(gate_drops),
        "prefilter_drop_rate": rate,
        "prefilter_by_pattern": dict(by_pattern),
        "invalidated_dropped": len(invalidated),
        "invalidated_by_family": dict(inv_by_family),
    }


def _double_geometry_ok(cand, candles: list[Candle], atr: float | None) -> bool:
    if atr is None or len(cand.shapes) != 1:
        return False
    shape = cand.shapes[0]
    points = shape.get("points") or []
    if len(points) < 2:
        return False
    neck = float(points[0]["price"])
    t0, t1 = int(points[0]["time"]), int(points[1]["time"])
    if abs(float(points[1]["price"]) - neck) > 1e-6:
        return False
    if cand.pattern_id == "double_top":
        highs_between = [c.high for c in candles if t0 <= c.time <= t1]
        if not highs_between:
            return False
        peak_cap = (
            cand.invalidation_price - 0.25 * atr
            if cand.invalidation_price is not None
            else neck + atr
        )
        return max(highs_between) <= peak_cap + 0.05 * atr
    return True


def _triangle_geometry_ok(cand, candles: list[Candle], catalog) -> bool:
    atr = catalog.atr or 1.0
    if len(cand.shapes) != 2:
        return False
    upper = lower = None
    for shape in cand.shapes:
        name = str(shape.get("name", "")).lower()
        if "upper" in name:
            upper = shape
        if "lower" in name:
            lower = shape
    if upper is None or lower is None:
        return False
    up = upper["points"]
    lo = lower["points"]
    if len(up) < 2 or len(lo) < 2:
        return False
    from cryptosignal_copilot.features import ZigZagSwing

    hu = ZigZagSwing(
        id="h0",
        i=0,
        t=int(up[0]["time"]),
        side="high",
        price=float(up[0]["price"]),
        prominence_atr=1,
    )
    hl = ZigZagSwing(
        id="h1",
        i=1,
        t=int(up[1]["time"]),
        side="high",
        price=float(up[1]["price"]),
        prominence_atr=1,
    )
    lu = ZigZagSwing(
        id="l0",
        i=2,
        t=int(lo[0]["time"]),
        side="low",
        price=float(lo[0]["price"]),
        prominence_atr=1,
    )
    ll = ZigZagSwing(
        id="l1",
        i=3,
        t=int(lo[1]["time"]),
        side="low",
        price=float(lo[1]["price"]),
        prominence_atr=1,
    )
    return (
        _triangle_close_fit(
            candles,
            hu=hu,
            hl=hl,
            lu=lu,
            ll=ll,
            window_end=candles[-1].time,
            atr=atr,
        )
        is not None
    )


def _assert_catalog_geometry(catalog, candles: list[Candle]) -> None:
    for cand in catalog.candidates:
        if cand.pattern_id in DOUBLE_PATTERNS:
            assert _double_geometry_ok(cand, candles, catalog.atr), cand.id
        if cand.pattern_id in TRIANGLE_PATTERNS:
            assert _triangle_geometry_ok(cand, candles, catalog), cand.id


def test_replay_fixtures_sixteen_windows():
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    assert len(fixtures) == 16


def test_replay_prefilter_rates():
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    suite_raw = 0
    suite_pf_dropped = 0
    for path in fixtures:
        symbol, interval, candles = _load_fixture(path.name)
        catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
        pf = _prefilter_metrics(catalog)
        suite_raw += int(pf["raw_candidates"])
        suite_pf_dropped += int(pf["prefilter_dropped"])
        _assert_catalog_geometry(catalog, candles)
    assert suite_pf_dropped / suite_raw <= 0.10


def test_replay_llm_like_top_six_exceeds_budget_without_fit():
    """Documents B2: top-6 by score can exceed shape budget before validator/fallback."""
    over_budget_windows = 0
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        symbol, interval, candles = _load_fixture(path.name)
        catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
        intents = simulate_llm_top_intents(catalog, "classic")
        total, _ = total_shape_cost(intents, catalog)
        if total > MAX_SHAPES:
            over_budget_windows += 1
    assert over_budget_windows >= 1


def test_replay_real_path_classic_and_smc():
    fixtures = sorted(FIXTURE_DIR.glob("*.json"))
    suite_classic: Counter[str] = Counter()
    suite_smc: Counter[str] = Counter()
    for path in fixtures:
        symbol, interval, candles = _load_fixture(path.name)
        catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
        classic_count = sum(1 for c in catalog.candidates if c.style == "classic")
        assert classic_count >= 1, path.name
        for style in ("classic", "smc"):
            valid, metrics = run_real_path(
                catalog, candles, symbol=symbol, interval=interval, style=style
            )
            assert metrics.split_picks == 0, f"{path.name} {style} split picks"
            assert metrics.invalidations_out == metrics.invalidations_in, (
                f"{path.name} {style} invalidations {metrics.invalidations_in}→{metrics.invalidations_out}"
            )
            assert metrics.evidence_out == metrics.evidence_in, (
                f"{path.name} {style} evidence {metrics.evidence_in}→{metrics.evidence_out}"
            )
            if style == "classic" and metrics.shapes_in:
                gate_rate = metrics.gate_dropped / metrics.shapes_in
                assert gate_rate <= 0.02, (
                    f"{path.name} gate={gate_rate:.3f} reasons={metrics.gate_reasons}"
                )
        suite_classic.update(c.pattern_id for c in catalog.candidates if c.style == "classic")
        suite_smc.update(c.pattern_id for c in catalog.candidates if c.style == "smc")
    assert suite_smc["fvg"] >= 1
    assert suite_smc["bos"] >= 1
    assert suite_smc["liquidity"] >= 1
    assert sum(suite_classic[p] for p in TRIANGLE_PATTERNS) >= 1
    assert sum(suite_classic[p] for p in DOUBLE_PATTERNS) >= 1


def test_replay_report_metrics(capsys):
    rows = []
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        symbol, interval, candles = _load_fixture(path.name)
        catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
        pf = _prefilter_metrics(catalog)
        _, m = run_real_path(catalog, candles, symbol=symbol, interval=interval, style="classic")
        rows.append(
            f"{path.name}: pf={pf['prefilter_drop_rate']:.1%} "
            f"gate={m.gate_dropped}/{m.shapes_in} split={m.split_picks} "
            f"inv={m.invalidations_in}→{m.invalidations_out}"
        )
    print("\n".join(rows))
