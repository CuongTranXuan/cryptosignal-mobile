from pathlib import Path

import numpy as np
import pandas as pd

from user_data.strategies.CryptoSignalStrategy import CryptoSignalStrategy


def candles(rows: int = 260) -> pd.DataFrame:
    close = np.linspace(60000.0, 62000.0, rows)
    return pd.DataFrame(
        {
            "date": pd.date_range("2026-01-01", periods=rows, freq="h", tz="UTC"),
            "open": close - 12,
            "high": close + 35,
            "low": close - 40,
            "close": close,
            "volume": np.linspace(100.0, 200.0, rows),
        }
    )


def test_strategy_emits_findings_but_never_trade_instructions() -> None:
    strategy = CryptoSignalStrategy({})
    frame = strategy.populate_indicators(candles(), {"pair": "BTC/USDT"})
    frame = strategy.populate_entry_trend(frame, {"pair": "BTC/USDT"})
    frame = strategy.populate_exit_trend(frame, {"pair": "BTC/USDT"})

    assert {"BULLISH_SETUP", "BEARISH_SETUP", "NEUTRAL"}.issuperset(set(frame["signal_state"].unique()))
    assert frame["signal_score"].dropna().between(-1.0, 1.0).all()
    assert frame["signal_confidence"].dropna().between(0.0, 1.0).all()
    assert {
        "doji_raw", "hammer_raw", "inverted_hammer_raw", "shooting_star_raw", "hanging_man_raw", "spinning_top_raw",
        "bullish_engulfing_raw", "bearish_engulfing_raw", "bullish_harami_raw", "bearish_harami_raw", "tweezer_top_raw", "tweezer_bottom_raw",
        "morning_star_raw", "evening_star_raw", "three_white_soldiers_raw", "three_black_crows_raw", "three_inside_up_raw", "three_inside_down_raw",
    }.issubset(frame.columns)
    assert (frame["enter_long"] == 0).all()
    assert (frame["enter_short"] == 0).all()
    assert (frame["exit_long"] == 0).all()
    assert (frame["exit_short"] == 0).all()


def test_runtime_version_document_is_present() -> None:
    assert (Path(__file__).parents[1] / "VERSIONS.md").is_file()
