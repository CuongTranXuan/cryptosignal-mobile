from cryptosignal_copilot.agent import estimate_prompt_candle_chars
from cryptosignal_copilot.schema import AnalyzeRequest, Candle


def _sample_request(n: int) -> AnalyzeRequest:
    candles = [
        Candle(time=1_700_000_000 + i * 3600, open=1.0, high=2.0, low=0.5, close=1.5, volume=100.0)
        for i in range(n)
    ]
    return AnalyzeRequest.model_validate(
        {
            "symbol": "BTCUSDT",
            "interval": "1h",
            "from": candles[0].time,
            "to": candles[-1].time,
            "closedCandles": [c.model_dump() for c in candles],
            "existingShapes": [],
            "prompt": "test",
        }
    )


def test_compact_candles_cut_serialized_size():
    req = _sample_request(100)
    verbose = estimate_prompt_candle_chars(req, compact=False)
    compact = estimate_prompt_candle_chars(req, compact=True)
    assert compact < verbose * 0.6
    rows = req.closedCandles
    assert rows[0].time == 1_700_000_000
    assert rows[-1].close == 1.5
