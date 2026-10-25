from cryptosignal_copilot.analysis_events import build_analysis_event, regime_to_bias
from cryptosignal_copilot.candidates import build_candidate_catalog
from tests.eval.test_chart_replay import _load_fixture


def test_regime_maps_to_detector_bias_not_user_intent():
    assert regime_to_bias("trend_up") == "bullish"
    assert regime_to_bias("trend_down") == "bearish"
    assert regime_to_bias("range") == "neutral"


def test_analysis_payload_has_evidence_and_confidence():
    symbol, interval, candles = _load_fixture("btcusdt_1h_200.json")
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    payload = build_analysis_event(catalog, [], {"detected_regime": catalog.regime}, symbol=symbol)
    assert payload["bias"] == regime_to_bias(catalog.regime)
    assert payload["evidence_for"]
    assert payload["evidence_against"] == []
    assert payload["no_valid_pattern"] is True
    assert payload["confidence"] is not None
