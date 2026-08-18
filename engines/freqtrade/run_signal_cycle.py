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


def build_snapshot(symbol: str, timeframe: str, dataframe: pd.DataFrame, config_version: int = 1) -> dict:
    strategy = CryptoSignalStrategy({})
    analyzed = strategy.populate_indicators(dataframe.copy(), {"pair": symbol})
    analyzed = strategy.populate_entry_trend(analyzed, {"pair": symbol})
    analyzed = strategy.populate_exit_trend(analyzed, {"pair": symbol})
    row = analyzed.iloc[-1]
    close_time = row["date"].to_pydatetime().astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    direction = "BULLISH" if row["signal_score"] > 0 else "BEARISH" if row["signal_score"] < 0 else "NEUTRAL"
    finding_specs = [
        ("TREND", "EMA_TREND_V1", abs(float(row["signal_score"])) >= 0.3, direction),
        ("MOMENTUM", "RSI_MACD_CONFIRMATION_V1", abs(float(row["signal_score"])) >= 0.2, direction),
        ("CANDLE_PATTERN", "DOJI_V1", float(row["doji_raw"]) > 0, "NEUTRAL"),
        ("CANDLE_PATTERN", "HAMMER_V1", float(row["hammer_raw"]) > 0, "BULLISH"),
        ("CANDLE_PATTERN", "INVERTED_HAMMER_V1", float(row["inverted_hammer_raw"]) > 0, "BULLISH"),
        ("CANDLE_PATTERN", "SHOOTING_STAR_V1", float(row["shooting_star_raw"]) > 0, "BEARISH"),
        ("CANDLE_PATTERN", "HANGING_MAN_V1", float(row["hanging_man_raw"]) > 0, "BEARISH"),
        ("CANDLE_PATTERN", "SPINNING_TOP_V1", float(row["spinning_top_raw"]) > 0, "NEUTRAL"),
        ("CANDLE_PATTERN", "BULLISH_ENGULFING_V1", float(row["bullish_engulfing_raw"]) > 0, "BULLISH"),
        ("CANDLE_PATTERN", "BEARISH_ENGULFING_V1", float(row["bearish_engulfing_raw"]) > 0, "BEARISH"),
        ("CANDLE_PATTERN", "BULLISH_HARAMI_V1", float(row["bullish_harami_raw"]) > 0, "BULLISH"),
        ("CANDLE_PATTERN", "BEARISH_HARAMI_V1", float(row["bearish_harami_raw"]) > 0, "BEARISH"),
        ("CANDLE_PATTERN", "TWEEZER_TOP_V1", bool(row["tweezer_top_raw"]), "BEARISH"),
        ("CANDLE_PATTERN", "TWEEZER_BOTTOM_V1", bool(row["tweezer_bottom_raw"]), "BULLISH"),
        ("CANDLE_PATTERN", "MORNING_STAR_V1", float(row["morning_star_raw"]) > 0, "BULLISH"),
        ("CANDLE_PATTERN", "EVENING_STAR_V1", float(row["evening_star_raw"]) > 0, "BEARISH"),
        ("CANDLE_PATTERN", "THREE_WHITE_SOLDIERS_V1", float(row["three_white_soldiers_raw"]) > 0, "BULLISH"),
        ("CANDLE_PATTERN", "THREE_BLACK_CROWS_V1", float(row["three_black_crows_raw"]) > 0, "BEARISH"),
        ("CANDLE_PATTERN", "THREE_INSIDE_UP_V1", float(row["three_inside_up_raw"]) > 0, "BULLISH"),
        ("CANDLE_PATTERN", "THREE_INSIDE_DOWN_V1", float(row["three_inside_down_raw"]) > 0, "BEARISH"),
    ]
    findings = [
        {
            "findingId": hashlib.sha256(f"{symbol}:{timeframe}:{close_time}:{rule_id}".encode()).hexdigest()[:24],
            "ruleFamily": family,
            "ruleId": rule_id,
            "direction": finding_direction,
            "strength": min(1.0, abs(float(row["signal_score"]))),
            "evidence": {
                "close": float(row["close"]),
                "ema20": float(row["ema_20"]),
                "ema50": float(row["ema_50"]),
                "rsi14": float(row["rsi_14"]),
                "relativeVolume": float(row["relative_volume"]),
            },
        }
        for family, rule_id, active, finding_direction in finding_specs
        if active
    ]
    candle_key = f"{symbol}:{timeframe}:{close_time}:0.1.0"
    return {
        "id": f"sig_{hashlib.sha256(candle_key.encode()).hexdigest()[:24]}",
        "assetSymbol": symbol,
        "venue": "binance_spot_public",
        "timeframe": timeframe,
        "candleCloseTime": close_time,
        "state": str(row["signal_state"]),
        "score": round(float(row["signal_score"]), 4),
        "confidence": round(float(row["signal_confidence"]), 4),
        "regime": "TREND_UP" if row["ema_20"] > row["ema_50"] else "TREND_DOWN" if row["ema_20"] < row["ema_50"] else "RANGE",
        "dataQualityState": str(row["data_quality_state"]),
        "findings": findings,
        "conflicts": [],
        "invalidation": {
            "type": "CLOSE_BELOW_ATR" if direction == "BULLISH" else "CLOSE_ABOVE_ATR",
            "price": round(float(row["close"] - row["atr_14"] if direction == "BULLISH" else row["close"] + row["atr_14"]), 4),
        },
        "strategyVersion": "0.1.0",
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
