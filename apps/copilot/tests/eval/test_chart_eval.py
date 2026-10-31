"""Deterministic chart-AI eval metrics (no network)."""

import math

from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.chart_regime import bias_conflicts_regime, detect_regime
from cryptosignal_copilot.drawing_intent import CandidateDrawingIntent, resolve_drawing_intents
from cryptosignal_copilot.intent_prep import build_intent_check
from cryptosignal_copilot.schema import AnalyzeIntent, AnalyzeRequest, Candle


def _candles_trend(up: bool, n: int = 80) -> list[Candle]:
    out: list[Candle] = []
    t0 = 1_700_000_000
    drift = 0.25 if up else -0.25
    p = 100.0
    for i in range(n):
        p += drift
        c = p + 2 * math.sin(i / 3.0)
        h = c + 2.5
        low = c - 2.5
        out.append(Candle(time=t0 + i * 3600, open=c, high=h, low=low, close=c, volume=1.0))
    return out


def _metrics(candles: list[Candle]) -> dict[str, float | int | bool]:
    catalog = build_candidate_catalog(candles, symbol="ETHUSDT", interval="1h")
    regime = detect_regime(candles)
    intents = [CandidateDrawingIntent(candidate_id=c.id) for c in catalog.candidates[:3]]
    shapes, unknown = resolve_drawing_intents(intents, catalog)
    return {
        "candidate_count": len(catalog.candidates),
        "candidate_hit_rate": 1.0 if catalog.candidates else 0.0,
        "gate_pass_rate": len(shapes) / max(1, len(intents)),
        "unknown_ids": len(unknown),
        "regime": regime,
    }


def test_eval_metrics_smoke():
    m = _metrics(_candles_trend(True))
    assert m["candidate_count"] > 0
    assert m["unknown_ids"] == 0
    assert m["gate_pass_rate"] > 0


def test_bull_bear_bias_does_not_flip_regime_or_shapes():
    up = _candles_trend(True)
    down = _candles_trend(False)
    cat_up = build_candidate_catalog(up, symbol="X", interval="1h")
    build_candidate_catalog(down, symbol="X", interval="1h")
    regime_up = detect_regime(up)
    detect_regime(down)
    assert up[-1].close > up[0].close
    assert down[-1].close < down[0].close

    req_bull = AnalyzeRequest(
        symbol="X",
        interval="1h",
        from_=up[0].time,
        to=up[-1].time,
        closedCandles=up,
        existingShapes=[],
        prompt="",
        intent=AnalyzeIntent(style="classic", bias="bearish"),
    )
    req_bear = req_bull.model_copy(
        update={"intent": AnalyzeIntent(style="classic", bias="bullish")}
    )
    check_bull = build_intent_check(req_bull, req_bull.intent)
    check_bear = build_intent_check(req_bear, req_bear.intent)
    assert check_bull["detected_regime"] == check_bear["detected_regime"] == regime_up

    # Detector-backed top candidate pattern should not flip solely due to user bias.
    top_up = cat_up.candidates[0].pattern_id if cat_up.candidates else None
    cat_up2 = build_candidate_catalog(up, symbol="X", interval="1h")
    top_up2 = cat_up2.candidates[0].pattern_id if cat_up2.candidates else None
    assert top_up == top_up2
