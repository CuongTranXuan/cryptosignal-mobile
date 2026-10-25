import math

from cryptosignal_copilot.candidates import build_candidate_catalog, PATTERNS_WITH_DETECTORS
from cryptosignal_copilot.features import fractal_swings, wilder_atr, zigzag_swings
from cryptosignal_copilot.schema import Candle


def _synthetic_uptrend(n: int = 80) -> list[Candle]:
    candles: list[Candle] = []
    price = 100.0
    t = 1_700_000_000
    for i in range(n):
        o = price
        c = 100 + i * 0.2 + 4 * math.sin(i / 2.5)
        h = c + 3 + abs(math.cos(i / 2.0))
        low = c - 3 - abs(math.sin(i / 2.0))
        candles.append(Candle(time=t + i * 3600, open=o, high=h, low=low, close=c, volume=10.0))
        price = c
    return candles


def test_fractal_and_atr_shared():
    candles = _synthetic_uptrend(40)
    atr = wilder_atr(candles)
    assert atr is not None and atr > 0
    swings = fractal_swings(candles, "1h")
    assert isinstance(swings, list)
    zz = zigzag_swings(candles, "1h")
    assert all(z.id.startswith("zz_") for z in zz)


def test_candidate_catalog_covers_detectors():
    candles = _synthetic_uptrend(100)
    catalog = build_candidate_catalog(candles, symbol="BTCUSDT", interval="1h")
    assert catalog.candidates
    found = {c.pattern_id for c in catalog.candidates}
    assert found & PATTERNS_WITH_DETECTORS
