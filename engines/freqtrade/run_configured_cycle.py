"""Execute the configured public-market watchlist cycle without order execution.

The runner reads the server's Telegram-owned configuration mirror, evaluates every
configured asset/timeframe on completed public Binance candles, and submits immutable
snapshots via the authenticated ingestion route. It does not use exchange credentials.
"""

from __future__ import annotations

import argparse
import json
import os

import requests

from run_signal_cycle import build_candle_history, build_snapshot, load_closed_candles


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base-url", default=os.getenv("CRYPTO_SIGNAL_API_BASE_URL", "http://127.0.0.1:3000"))
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args()
    api_base_url = args.api_base_url.rstrip("/")
    token = os.getenv("SIGNAL_INGEST_TOKEN")
    if not token:
        raise RuntimeError("SIGNAL_INGEST_TOKEN is required")

    config_response = requests.get(f"{api_base_url}/api/signals/config", timeout=15)
    config_response.raise_for_status()
    config = config_response.json()["config"]
    if config["isPaused"]:
        print(json.dumps({"ok": True, "skipped": True, "reason": "PAUSED", "configVersion": config["configVersion"]}))
        return

    results = []
    for symbol in config["watchlist"]:
        for timeframe in config["timeframes"]:
            try:
                candles = load_closed_candles(symbol, timeframe, args.limit)
                snapshot = build_snapshot(symbol, timeframe, candles, config["configVersion"])
                history = build_candle_history(symbol, timeframe, candles, config["configVersion"])
                history_response = requests.post(
                    f"{api_base_url}/api/signals/candles",
                    headers={"content-type": "application/json", "x-signal-ingest-token": token},
                    json={"candles": history},
                    timeout=30,
                )
                history_response.raise_for_status()
                response = requests.post(
                    f"{api_base_url}/api/signals/ingest",
                    headers={"content-type": "application/json", "x-signal-ingest-token": token},
                    json=snapshot,
                    timeout=20,
                )
                response.raise_for_status()
                results.append({"assetSymbol": symbol, "timeframe": timeframe, "state": snapshot["state"], "score": snapshot["score"], "candlesRecorded": history_response.json().get("recorded"), "result": response.json().get("alert")})
            except Exception as error:
                results.append({"assetSymbol": symbol, "timeframe": timeframe, "error": str(error)})
    print(json.dumps({"ok": True, "configVersion": config["configVersion"], "results": results}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
