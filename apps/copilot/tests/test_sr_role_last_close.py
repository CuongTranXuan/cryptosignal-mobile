"""N10: flipped S/R role must match last close vs zone bounds."""

from cryptosignal_copilot.candidates import build_candidate_catalog
from tests.eval.test_chart_replay import _load_fixture


def _wrong_role_flipped_count(catalog, candles) -> int:
    close = float(candles[-1].close)
    wrong = 0
    for cand in catalog.candidates:
        if cand.pattern_id != "support_resistance":
            continue
        name = cand.name.lower()
        if "flipped" not in name:
            continue
        shape = cand.shapes[0] if cand.shapes else {}
        low = float(shape.get("priceLow") or 0)
        high = float(shape.get("priceHigh") or 0)
        if "support (flipped)" in name and close <= high:
            wrong += 1
        elif "resistance (flipped)" in name and close >= low:
            wrong += 1
    return wrong


def test_flipped_sr_roles_match_last_close_eth_1h():
    symbol, interval, candles = _load_fixture("ethusdt_1h_200.json")
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)
    wrong = _wrong_role_flipped_count(catalog, candles)
    assert wrong == 0, f"expected 0 wrong-role flipped zones, got {wrong}"
