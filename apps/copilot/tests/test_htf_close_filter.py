import pytest

from cryptosignal_copilot.analyze_prep import _htf_context
from cryptosignal_copilot.drawing_gate import bar_seconds


@pytest.mark.asyncio
async def test_sol_4h_htf_excludes_unclosed_daily_candle(monkeypatch):
    """SOL 4h window end must not include 1d bar that closes after LTF close."""

    async def fake_fetch(symbol, interval, limit=120, end_time=None, **kwargs):
        from cryptosignal_copilot.schema import Candle

        ltf_end_open = 1788566400
        rows: list[Candle] = []
        for i in range(15):
            t = ltf_end_open - (15 - i) * 86400
            rows.append(Candle(time=t, open=1.0, high=2.0, low=0.5, close=1.5, volume=1.0))
        rows.append(
            Candle(
                time=ltf_end_open,
                open=1.5,
                high=2.0,
                low=1.0,
                close=1.8,
                volume=1.0,
            )
        )
        return rows

    monkeypatch.setattr("cryptosignal_copilot.analyze_prep.fetch_klines", fake_fetch)
    ltf_end_open = 1788566400
    ctx = await _htf_context("SOLUSDT", "4h", ltf_end_open, ltf_interval="4h")
    assert ctx is not None
    htf_sec = bar_seconds("1d")
    assert int(ctx["last_closed_time"]) == ltf_end_open - 86400 + htf_sec
    assert ctx["last_closed_open_time"] == ltf_end_open - 86400
