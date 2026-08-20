"""Run one closed-candle CryptoSignal analysis cycle with the pinned Freqtrade strategy.

This development runner fetches public Binance Spot OHLCV data, discards the open
candle, evaluates the custom Freqtrade adapter, and optionally persists the immutable
signal through the application's authenticated HTTP ingestion route. It never creates
orders, uses exchange private keys, or invokes Freqtrade's trade command.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
import sys

sys.path.insert(0, str(ROOT))

from user_data.strategies.CryptoSignalStrategy import CryptoSignalStrategy


BINANCE_KLINE_ENDPOINTS = (
    "https://api.binance.com/api/v3/klines",
    "https://data-api.binance.vision/api/v3/klines",
    "https://api.binance.us/api/v3/klines",
)


def load_closed_candles(symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    rows = None
    errors: list[str] = []
    for endpoint in BINANCE_KLINE_ENDPOINTS:
        try:
            response = requests.get(
                endpoint,
                params={"symbol": symbol.replace("/", ""), "interval": timeframe, "limit": limit},
                timeout=(5, 15),
            )
            response.raise_for_status()
            rows = response.json()
            break
        except requests.RequestException as error:
            errors.append(f"{endpoint}: {error}")
    if rows is None:
        raise RuntimeError("Unable to retrieve public Binance OHLCV. " + " | ".join(errors))
    if len(rows) < 211:
        raise RuntimeError(f"Expected at least 211 candles, received {len(rows)}")
    frame = pd.DataFrame(rows, columns=[
        "open_time", "open", "high", "low", "close", "volume", "close_time", "quote_volume", "trades", "taker_base", "taker_quote", "ignore"
    ])
    frame["date"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
    for column in ["open", "high", "low", "close", "volume"]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    # Binance may return a still-forming final candle. The engine consumes only
    # closed candles to avoid repainting and preserve deterministic replay.
    return frame.iloc[:-1][["date", "open", "high", "low", "close", "volume"]].reset_index(drop=True)


def build_snapshot(
    symbol: str,
    timeframe: str,
    dataframe: pd.DataFrame,
    config_version: int = 1,
    analysis_config: dict | None = None,
) -> dict:
    strategy = CryptoSignalStrategy({})
    analyzed = strategy.populate_indicators(dataframe.copy(), {"pair": symbol})
    analyzed = strategy.populate_entry_trend(analyzed, {"pair": symbol})
    analyzed = strategy.populate_exit_trend(analyzed, {"pair": symbol})
    row = analyzed.iloc[-1]
    close_time = row["date"].to_pydatetime().astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    analysis_config = analysis_config or {}
    rule_families = set(analysis_config.get("ruleFamilies", ["TREND", "MOMENTUM", "VOLUME", "CANDLE_PATTERN"]))
    enabled_patterns = set(analysis_config.get("enabledPatterns", [
        "DOJI_V1", "HAMMER_V1", "INVERTED_HAMMER_V1", "SHOOTING_STAR_V1", "HANGING_MAN_V1", "SPINNING_TOP_V1",
        "BULLISH_ENGULFING_V1", "BEARISH_ENGULFING_V1", "BULLISH_HARAMI_V1", "BEARISH_HARAMI_V1", "TWEEZER_TOP_V1", "TWEEZER_BOTTOM_V1",
        "MORNING_STAR_V1", "EVENING_STAR_V1", "THREE_WHITE_SOLDIERS_V1", "THREE_BLACK_CROWS_V1", "THREE_INSIDE_UP_V1", "THREE_INSIDE_DOWN_V1",
    ]))
    enabled_methodologies = set(analysis_config.get("enabledMethodologies", [
        "EMA_TREND_V1", "RSI_MACD_CONFIRMATION_V1", "VOLUME_CONFIRMATION_V1", "WYCKOFF_SPRING_PROXY_V1", "WYCKOFF_UPTHRUST_PROXY_V1",
        "SMC_BULLISH_BOS_PROXY_V1", "SMC_BEARISH_BOS_PROXY_V1", "ELLIOTT_BULLISH_IMPULSE_PROXY_V1", "ELLIOTT_BEARISH_IMPULSE_PROXY_V1",
    ]))
    trend_direction = "BULLISH" if row["ema_20"] > row["ema_50"] > row["ema_200"] else "BEARISH" if row["ema_20"] < row["ema_50"] < row["ema_200"] else "NEUTRAL"
    momentum_direction = "BULLISH" if row["rsi_14"] >= 50 and row["macd"] >= row["macd_signal"] else "BEARISH" if row["rsi_14"] <= 50 and row["macd"] <= row["macd_signal"] else "NEUTRAL"
    volume_direction = "BULLISH" if row["relative_volume"] >= 1 and row["close"] > row["open"] else "BEARISH" if row["relative_volume"] >= 1 and row["close"] < row["open"] else "NEUTRAL"
    finding_specs = [
        ("TREND", "EMA_TREND_V1", trend_direction != "NEUTRAL", trend_direction, 0.30),
        ("MOMENTUM", "RSI_MACD_CONFIRMATION_V1", momentum_direction != "NEUTRAL", momentum_direction, 0.20),
        ("VOLUME", "VOLUME_CONFIRMATION_V1", volume_direction != "NEUTRAL", volume_direction, 0.10),
        ("WYCKOFF", "WYCKOFF_SPRING_PROXY_V1", bool(row["wyckoff_spring_proxy_raw"]), "BULLISH", 0.16),
        ("WYCKOFF", "WYCKOFF_UPTHRUST_PROXY_V1", bool(row["wyckoff_upthrust_proxy_raw"]), "BEARISH", 0.16),
        ("SMC", "SMC_BULLISH_BOS_PROXY_V1", bool(row["smc_bullish_bos_proxy_raw"]), "BULLISH", 0.18),
        ("SMC", "SMC_BEARISH_BOS_PROXY_V1", bool(row["smc_bearish_bos_proxy_raw"]), "BEARISH", 0.18),
        ("ELLIOTT_EXPERIMENTAL", "ELLIOTT_BULLISH_IMPULSE_PROXY_V1", bool(row["elliott_bullish_impulse_proxy_raw"]), "BULLISH", 0.12),
        ("ELLIOTT_EXPERIMENTAL", "ELLIOTT_BEARISH_IMPULSE_PROXY_V1", bool(row["elliott_bearish_impulse_proxy_raw"]), "BEARISH", 0.12),
        ("CANDLE_PATTERN", "DOJI_V1", float(row["doji_raw"]) > 0, "NEUTRAL", 0.0),
        ("CANDLE_PATTERN", "HAMMER_V1", float(row["hammer_raw"]) > 0, "BULLISH", 0.06),
        ("CANDLE_PATTERN", "INVERTED_HAMMER_V1", float(row["inverted_hammer_raw"]) > 0, "BULLISH", 0.06),
        ("CANDLE_PATTERN", "SHOOTING_STAR_V1", float(row["shooting_star_raw"]) > 0, "BEARISH", 0.06),
        ("CANDLE_PATTERN", "HANGING_MAN_V1", float(row["hanging_man_raw"]) > 0, "BEARISH", 0.06),
        ("CANDLE_PATTERN", "SPINNING_TOP_V1", float(row["spinning_top_raw"]) > 0, "NEUTRAL", 0.0),
        ("CANDLE_PATTERN", "BULLISH_ENGULFING_V1", float(row["bullish_engulfing_raw"]) > 0, "BULLISH", 0.15),
        ("CANDLE_PATTERN", "BEARISH_ENGULFING_V1", float(row["bearish_engulfing_raw"]) > 0, "BEARISH", 0.15),
        ("CANDLE_PATTERN", "BULLISH_HARAMI_V1", float(row["bullish_harami_raw"]) > 0, "BULLISH", 0.10),
        ("CANDLE_PATTERN", "BEARISH_HARAMI_V1", float(row["bearish_harami_raw"]) > 0, "BEARISH", 0.10),
        ("CANDLE_PATTERN", "TWEEZER_TOP_V1", bool(row["tweezer_top_raw"]), "BEARISH", 0.10),
        ("CANDLE_PATTERN", "TWEEZER_BOTTOM_V1", bool(row["tweezer_bottom_raw"]), "BULLISH", 0.10),
        ("CANDLE_PATTERN", "MORNING_STAR_V1", float(row["morning_star_raw"]) > 0, "BULLISH", 0.15),
        ("CANDLE_PATTERN", "EVENING_STAR_V1", float(row["evening_star_raw"]) > 0, "BEARISH", 0.15),
        ("CANDLE_PATTERN", "THREE_WHITE_SOLDIERS_V1", float(row["three_white_soldiers_raw"]) > 0, "BULLISH", 0.15),
        ("CANDLE_PATTERN", "THREE_BLACK_CROWS_V1", float(row["three_black_crows_raw"]) > 0, "BEARISH", 0.15),
        ("CANDLE_PATTERN", "THREE_INSIDE_UP_V1", float(row["three_inside_up_raw"]) > 0, "BULLISH", 0.12),
        ("CANDLE_PATTERN", "THREE_INSIDE_DOWN_V1", float(row["three_inside_down_raw"]) > 0, "BEARISH", 0.12),
    ]
    active_specs = [
        spec for spec in finding_specs
        if spec[2]
        and spec[0] in rule_families
        and (spec[1] in enabled_patterns if spec[0] == "CANDLE_PATTERN" else spec[1] in enabled_methodologies)
    ]
    score = sum(spec[4] if spec[3] == "BULLISH" else -spec[4] if spec[3] == "BEARISH" else 0.0 for spec in active_specs)
    score = max(-1.0, min(1.0, score))
    threshold = float(analysis_config.get("alertThreshold", 0.35))
    direction = "BULLISH" if score > 0 else "BEARISH" if score < 0 else "NEUTRAL"
    state = "BULLISH_SETUP" if score >= threshold else "BEARISH_SETUP" if score <= -threshold else "NEUTRAL"
    confidence = min(1.0, abs(score) * 0.75 + min(float(row["adx_14"]), 40.0) / 40.0 * 0.25)
    findings = [
        {
            "findingId": hashlib.sha256(f"{symbol}:{timeframe}:{close_time}:{rule_id}".encode()).hexdigest()[:24],
            "ruleFamily": family,
            "ruleId": rule_id,
            "direction": finding_direction,
            "strength": weight,
            "evidence": {
                "closedCandle": True,
                "close": float(row["close"]),
                "ema20": float(row["ema_20"]),
                "ema50": float(row["ema_50"]),
                "ema200": float(row["ema_200"]),
                "rsi14": float(row["rsi_14"]),
                "macd": float(row["macd"]),
                "macdSignal": float(row["macd_signal"]),
                "relativeVolume": float(row["relative_volume"]),
                "experimentalProxy": family in {"WYCKOFF", "SMC", "ELLIOTT_EXPERIMENTAL"},
            },
        }
        for family, rule_id, active, finding_direction, weight in active_specs
    ]
    candle_key = f"{symbol}:{timeframe}:{close_time}:0.2.0:{config_version}"
    return {
        "id": f"sig_{hashlib.sha256(candle_key.encode()).hexdigest()[:24]}",
        "assetSymbol": symbol,
        "venue": "binance_spot_public",
        "timeframe": timeframe,
        "candleCloseTime": close_time,
        "state": state,
        "score": round(score, 4),
        "confidence": round(confidence, 4),
        "regime": "TREND_UP" if row["ema_20"] > row["ema_50"] else "TREND_DOWN" if row["ema_20"] < row["ema_50"] else "RANGE",
        "dataQualityState": str(row["data_quality_state"]),
        "findings": findings,
        "conflicts": [],
        "invalidation": {
            "type": "CLOSE_BELOW_ATR" if direction == "BULLISH" else "CLOSE_ABOVE_ATR" if direction == "BEARISH" else "CLOSE_OUTSIDE_ATR_RANGE",
            "price": round(float(row["close"] - row["atr_14"] if direction == "BULLISH" else row["close"] + row["atr_14"] if direction == "BEARISH" else row["close"]), 4),
        },
        "strategyVersion": "0.2.0",
        "configVersion": config_version,
        "sourceManifestId": f"binance:{symbol.replace('/', '')}:{timeframe}:{close_time}",
    }


def build_candle_history(symbol: str, timeframe: str, dataframe: pd.DataFrame, config_version: int = 1, history_limit: int = 240) -> list[dict]:
    """Return closed candles and calculated indicators for durable chart rendering."""
    strategy = CryptoSignalStrategy({})
    analyzed = strategy.populate_indicators(dataframe.copy(), {"pair": symbol})
    history: list[dict] = []
    required = ["ema_20", "ema_50", "ema_200", "rsi_14", "macd", "macd_signal", "atr_14"]
    for _, row in analyzed.tail(history_limit).iterrows():
        if any(pd.isna(row[column]) for column in required):
            continue
        close_time = row["date"].to_pydatetime().astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        candle_key = f"{symbol}:{timeframe}:{close_time}:0.1.0"
        history.append(
            {
                "id": f"candle_{hashlib.sha256(candle_key.encode()).hexdigest()[:48]}",
                "assetSymbol": symbol,
                "venue": "binance_spot_public",
                "timeframe": timeframe,
                "candleCloseTime": close_time,
                "open": float(row["open"]), "high": float(row["high"]), "low": float(row["low"]), "close": float(row["close"]), "volume": float(row["volume"]),
                "ema20": float(row["ema_20"]), "ema50": float(row["ema_50"]), "ema200": float(row["ema_200"]),
                "rsi14": float(row["rsi_14"]), "macd": float(row["macd"]), "macdSignal": float(row["macd_signal"]), "atr14": float(row["atr_14"]),
                "signalState": str(row["signal_state"]), "signalScore": round(float(row["signal_score"]), 4),
                "strategyVersion": "0.1.0", "configVersion": config_version,
            }
        )
    return history


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="BTC/USDT")
    parser.add_argument("--timeframe", default="1h")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--submit", action="store_true", help="Persist through the local authenticated API")
    parser.add_argument("--config-version", type=int, default=1, help="Version from the Telegram-owned configuration mirror")
    parser.add_argument("--api-base-url", default=os.getenv("CRYPTO_SIGNAL_API_BASE_URL", "http://127.0.0.1:3000"))
    args = parser.parse_args()

    candles = load_closed_candles(args.symbol.upper(), args.timeframe, args.limit)
    snapshot = build_snapshot(args.symbol.upper(), args.timeframe, candles, args.config_version)
    history = build_candle_history(args.symbol.upper(), args.timeframe, candles, args.config_version)
    print(json.dumps(snapshot, indent=2, sort_keys=True))
    if not args.submit:
        return

    token = os.getenv("SIGNAL_INGEST_TOKEN")
    if not token:
        raise RuntimeError("SIGNAL_INGEST_TOKEN is required with --submit")
    history_response = requests.post(
        f"{args.api_base_url.rstrip('/')}/api/signals/candles",
        headers={"content-type": "application/json", "x-signal-ingest-token": token},
        json={"candles": history},
        timeout=30,
    )
    history_response.raise_for_status()
    response = requests.post(
        f"{args.api_base_url.rstrip('/')}/api/signals/ingest",
        headers={"content-type": "application/json", "x-signal-ingest-token": token},
        json=snapshot,
        timeout=20,
    )
    response.raise_for_status()
    print(json.dumps({"historySubmission": history_response.json(), "submission": response.json()}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
