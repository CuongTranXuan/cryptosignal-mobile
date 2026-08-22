"""Freqtrade adapter for closed-candle CryptoSignal findings.

This strategy intentionally produces no order instructions. It uses Freqtrade's
unmodified OHLCV lifecycle for vectorized features and exposes finding columns
for the external control plane to serialize into immutable SignalSnapshot data.
"""

from __future__ import annotations

import numpy as np
import talib.abstract as ta
from pandas import DataFrame

from freqtrade.strategy import IStrategy


class CryptoSignalStrategy(IStrategy):
    """Signals-only strategy adapter; never opens, closes, or manages a trade."""

    INTERFACE_VERSION = 3
    timeframe = "1h"
    process_only_new_candles = True
    startup_candle_count = 210
    can_short = False

    # These required Freqtrade fields are deliberately inert. Any future attempt
    # to enable execution must fail separate deployment-policy review first.
    minimal_roi = {"0": 1000.0}
    stoploss = -0.99
    use_exit_signal = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["ema_20"] = ta.EMA(dataframe, timeperiod=20)
        dataframe["ema_50"] = ta.EMA(dataframe, timeperiod=50)
        dataframe["ema_200"] = ta.EMA(dataframe, timeperiod=200)
        dataframe["rsi_14"] = ta.RSI(dataframe, timeperiod=14)
        dataframe["adx_14"] = ta.ADX(dataframe, timeperiod=14)
        dataframe["atr_14"] = ta.ATR(dataframe, timeperiod=14)

        macd = ta.MACD(dataframe, fastperiod=12, slowperiod=26, signalperiod=9)
        dataframe["macd"] = macd["macd"]
        dataframe["macd_signal"] = macd["macdsignal"]
        dataframe["relative_volume"] = dataframe["volume"] / dataframe["volume"].rolling(20).mean()

        dataframe["bullish_engulfing_raw"] = ta.CDLENGULFING(dataframe).clip(lower=0)
        dataframe["bearish_engulfing_raw"] = (-ta.CDLENGULFING(dataframe)).clip(lower=0)
        dataframe["doji_raw"] = ta.CDLDOJI(dataframe).clip(lower=0)
        dataframe["hammer_raw"] = ta.CDLHAMMER(dataframe).clip(lower=0)
        dataframe["inverted_hammer_raw"] = ta.CDLINVERTEDHAMMER(dataframe).clip(lower=0)
        dataframe["shooting_star_raw"] = (-ta.CDLSHOOTINGSTAR(dataframe)).clip(lower=0)
        dataframe["hanging_man_raw"] = (-ta.CDLHANGINGMAN(dataframe)).clip(lower=0)
        dataframe["spinning_top_raw"] = ta.CDLSPINNINGTOP(dataframe).abs()
        dataframe["bullish_harami_raw"] = ta.CDLHARAMI(dataframe).clip(lower=0)
        dataframe["bearish_harami_raw"] = (-ta.CDLHARAMI(dataframe)).clip(lower=0)
        dataframe["morning_star_raw"] = ta.CDLMORNINGSTAR(dataframe).clip(lower=0)
        dataframe["evening_star_raw"] = (-ta.CDLEVENINGSTAR(dataframe)).clip(lower=0)
        dataframe["three_white_soldiers_raw"] = ta.CDL3WHITESOLDIERS(dataframe).clip(lower=0)
        dataframe["three_black_crows_raw"] = ta.CDL3BLACKCROWS(dataframe).abs()
        dataframe["three_inside_up_raw"] = ta.CDL3INSIDE(dataframe).clip(lower=0)
        dataframe["three_inside_down_raw"] = (-ta.CDL3INSIDE(dataframe)).clip(lower=0)
        dataframe["tweezer_top_raw"] = (
            (dataframe["high"] - dataframe["high"].shift(1)).abs() <= dataframe["atr_14"] * 0.10
        ) & (dataframe["close"].shift(1) > dataframe["open"].shift(1)) & (dataframe["close"] < dataframe["open"])
        dataframe["tweezer_bottom_raw"] = (
            (dataframe["low"] - dataframe["low"].shift(1)).abs() <= dataframe["atr_14"] * 0.10
        ) & (dataframe["close"].shift(1) < dataframe["open"].shift(1)) & (dataframe["close"] > dataframe["open"])
        dataframe["prior_range_high_20"] = dataframe["high"].rolling(20).max().shift(1)
        dataframe["prior_range_low_20"] = dataframe["low"].rolling(20).min().shift(1)
        dataframe["wyckoff_spring_proxy_raw"] = (
            (dataframe["low"] < dataframe["prior_range_low_20"])
            & (dataframe["close"] > dataframe["prior_range_low_20"])
            & (dataframe["relative_volume"] >= 1.0)
        )
        dataframe["wyckoff_upthrust_proxy_raw"] = (
            (dataframe["high"] > dataframe["prior_range_high_20"])
            & (dataframe["close"] < dataframe["prior_range_high_20"])
            & (dataframe["relative_volume"] >= 1.0)
        )
        dataframe["smc_bullish_bos_proxy_raw"] = (
            (dataframe["close"] > dataframe["prior_range_high_20"])
            & (dataframe["relative_volume"] >= 1.0)
        )
        dataframe["smc_bearish_bos_proxy_raw"] = (
            (dataframe["close"] < dataframe["prior_range_low_20"])
            & (dataframe["relative_volume"] >= 1.0)
        )
        dataframe["elliott_bullish_impulse_proxy_raw"] = (
            (dataframe["close"] > dataframe["close"].shift(1))
            & (dataframe["close"].shift(1) > dataframe["close"].shift(2))
            & (dataframe["close"].shift(2) > dataframe["close"].shift(3))
            & (dataframe["ema_20"] > dataframe["ema_50"])
        )
        dataframe["elliott_bearish_impulse_proxy_raw"] = (
            (dataframe["close"] < dataframe["close"].shift(1))
            & (dataframe["close"].shift(1) < dataframe["close"].shift(2))
            & (dataframe["close"].shift(2) < dataframe["close"].shift(3))
            & (dataframe["ema_20"] < dataframe["ema_50"])
        )

        trend_bullish = (dataframe["ema_20"] > dataframe["ema_50"]) & (
            dataframe["ema_50"] > dataframe["ema_200"]
        )
        trend_bearish = (dataframe["ema_20"] < dataframe["ema_50"]) & (
            dataframe["ema_50"] < dataframe["ema_200"]
        )
        momentum_bullish = (dataframe["rsi_14"] >= 50) & (dataframe["macd"] > dataframe["macd_signal"])
        momentum_bearish = (dataframe["rsi_14"] <= 50) & (dataframe["macd"] < dataframe["macd_signal"])
        volume_confirmed = dataframe["relative_volume"] >= 1.0

        dataframe["signal_score"] = 0.0
        dataframe.loc[trend_bullish, "signal_score"] += 0.30
        dataframe.loc[trend_bearish, "signal_score"] -= 0.30
        dataframe.loc[momentum_bullish, "signal_score"] += 0.20
        dataframe.loc[momentum_bearish, "signal_score"] -= 0.20
        dataframe.loc[volume_confirmed & trend_bullish, "signal_score"] += 0.10
        dataframe.loc[volume_confirmed & trend_bearish, "signal_score"] -= 0.10
        dataframe.loc[dataframe["bullish_engulfing_raw"] > 0, "signal_score"] += 0.15
        dataframe.loc[dataframe["bearish_engulfing_raw"] > 0, "signal_score"] -= 0.15
        dataframe.loc[dataframe["hammer_raw"] > 0, "signal_score"] += 0.05
        dataframe.loc[dataframe["inverted_hammer_raw"] > 0, "signal_score"] += 0.05
        dataframe.loc[dataframe["shooting_star_raw"] > 0, "signal_score"] -= 0.05
        dataframe.loc[dataframe["hanging_man_raw"] > 0, "signal_score"] -= 0.05
        dataframe.loc[dataframe["bullish_harami_raw"] > 0, "signal_score"] += 0.10
        dataframe.loc[dataframe["bearish_harami_raw"] > 0, "signal_score"] -= 0.10
        dataframe.loc[dataframe["morning_star_raw"] > 0, "signal_score"] += 0.15
        dataframe.loc[dataframe["evening_star_raw"] > 0, "signal_score"] -= 0.15
        dataframe.loc[dataframe["three_white_soldiers_raw"] > 0, "signal_score"] += 0.15
        dataframe.loc[dataframe["three_black_crows_raw"] > 0, "signal_score"] -= 0.15
        dataframe.loc[dataframe["three_inside_up_raw"] > 0, "signal_score"] += 0.12
        dataframe.loc[dataframe["three_inside_down_raw"] > 0, "signal_score"] -= 0.12
        dataframe.loc[dataframe["tweezer_bottom_raw"], "signal_score"] += 0.10
        dataframe.loc[dataframe["tweezer_top_raw"], "signal_score"] -= 0.10
        dataframe.loc[dataframe["wyckoff_spring_proxy_raw"], "signal_score"] += 0.16
        dataframe.loc[dataframe["wyckoff_upthrust_proxy_raw"], "signal_score"] -= 0.16
        dataframe.loc[dataframe["smc_bullish_bos_proxy_raw"], "signal_score"] += 0.18
        dataframe.loc[dataframe["smc_bearish_bos_proxy_raw"], "signal_score"] -= 0.18
        dataframe.loc[dataframe["elliott_bullish_impulse_proxy_raw"], "signal_score"] += 0.12
        dataframe.loc[dataframe["elliott_bearish_impulse_proxy_raw"], "signal_score"] -= 0.12
        dataframe["signal_score"] = dataframe["signal_score"].clip(lower=-1.0, upper=1.0)

        dataframe["signal_state"] = np.select(
            [
                dataframe["signal_score"] >= 0.35,
                dataframe["signal_score"] <= -0.35,
            ],
            ["BULLISH_SETUP", "BEARISH_SETUP"],
            default="NEUTRAL",
        )
        dataframe["signal_confidence"] = (
            dataframe["signal_score"].abs() * 0.75
            + dataframe["adx_14"].clip(upper=40).fillna(0) / 40 * 0.25
        ).clip(lower=0.0, upper=1.0)
        dataframe["data_quality_state"] = np.where(dataframe["volume"] > 0, "PASS", "MISSING_VOLUME")
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """Execution guard: the signals-only deployment may never place an entry."""
        dataframe["enter_long"] = 0
        dataframe["enter_short"] = 0
        dataframe["enter_tag"] = "signals_only"
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """Execution guard: the signals-only deployment may never place an exit."""
        dataframe["exit_long"] = 0
        dataframe["exit_short"] = 0
        dataframe["exit_tag"] = "signals_only"
        return dataframe
