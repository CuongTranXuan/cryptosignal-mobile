from cryptosignal_copilot.schema import filter_preview_details
from tests.test_drawing_gate import make_candles, make_window, on_line, trendline, ts


def test_filter_preview_preserves_guardrail_and_candidate_id():
    rows = make_candles(
        wicks={
            20: (100.0, 130.0),
            32: (106.0, 136.0),
        }
    )
    forward = 44
    guardrail = {
        "regime": "range",
        "confidence": 0.72,
        "evidence_against": ["neckline not broken"],
        "invalidation": {"price": 99.0, "condition": "close_above"},
    }
    raw = trendline(
        "base",
        "Channel lower",
        (ts(20), 100.0),
        (ts(forward), on_line(forward, 20, 100.0, 32, 106.0)),
    )
    raw["guardrail"] = guardrail
    raw["_candidate_id"] = "ch_abc123456789"
    valid, dropped = filter_preview_details(
        [raw],
        {row.time for row in rows},
        symbol="BTCUSDT",
        interval="1h",
        window=make_window(rows),
    )
    assert dropped == []
    assert len(valid) == 1
    assert valid[0].get("guardrail") == guardrail
    assert valid[0].get("_candidate_id") == "ch_abc123456789"
