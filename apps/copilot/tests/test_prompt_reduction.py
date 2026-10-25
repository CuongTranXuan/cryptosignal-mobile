from cryptosignal_copilot.analyze_prep import trim_request_candles
from cryptosignal_copilot.prompt_context import estimate_prompt_candle_chars
from cryptosignal_copilot.schema import AnalyzeRequest, Candle


def test_prompt_candle_reduction_compact_tail():
    candles = [Candle(time=i, open=1, high=2, low=1, close=2, volume=1) for i in range(100)]
    req = AnalyzeRequest(
        symbol="BTC",
        interval="1h",
        from_=0,
        to=99,
        closedCandles=candles,
        existingShapes=[],
        prompt="x",
    )
    legacy = estimate_prompt_candle_chars(req, compact=False)
    compact = estimate_prompt_candle_chars(req, compact=True)
    assert compact < legacy
    assert (1 - compact / legacy) > 0.5
