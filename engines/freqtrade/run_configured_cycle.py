"""Execute the configured public-market watchlist cycle without order execution.

The runner reads the server's Telegram-owned configuration mirror, evaluates every
configured asset/timeframe on completed public Binance candles, and submits immutable
snapshots via the authenticated ingestion route. It does not use exchange credentials.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from uuid import uuid4

import requests

from run_signal_cycle import build_candle_history, build_snapshot, load_closed_candles


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def report_runner_health(api_base_url: str, token: str, payload: dict) -> None:
    response = requests.post(
        f"{api_base_url}/api/signals/runner-health",
        headers={"content-type": "application/json", "x-signal-ingest-token": token},
        json=payload,
        timeout=15,
    )
    response.raise_for_status()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base-url", default=os.getenv("CRYPTO_SIGNAL_API_BASE_URL", "http://127.0.0.1:3000"))
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--quiet", action="store_true", help="Suppress the summary output for cron execution.")
    args = parser.parse_args()
    api_base_url = args.api_base_url.rstrip("/")
    token = os.getenv("SIGNAL_INGEST_TOKEN")
    if not token:
        raise RuntimeError("SIGNAL_INGEST_TOKEN is required")

    run_id = str(uuid4())
    started_at = utc_now()
    try:
        config_response = requests.get(f"{api_base_url}/api/signals/config", timeout=15)
        config_response.raise_for_status()
        config = config_response.json()["config"]
    except Exception as error:
        if not args.quiet:
            print(json.dumps({"ok": False, "error": str(error)}, sort_keys=True))
        raise

    report_runner_health(api_base_url, token, {
        "runId": run_id, "state": "RUNNING", "configVersion": config["configVersion"],
        "startedAt": started_at, "finishedAt": None, "cycleCount": 0, "failureCount": 0,
        "lastError": None, "summary": {},
    })
    if config["isPaused"]:
        report_runner_health(api_base_url, token, {
            "runId": run_id, "state": "PAUSED", "configVersion": config["configVersion"],
            "startedAt": started_at, "finishedAt": utc_now(), "cycleCount": 0, "failureCount": 0,
            "lastError": None, "summary": {"reason": "PAUSED"},
        })
        if not args.quiet:
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
    failures = [result for result in results if "error" in result]
    state = "SUCCESS" if not failures else "DEGRADED"
    summary = {"ok": not failures, "configVersion": config["configVersion"], "results": results}
    report_runner_health(api_base_url, token, {
        "runId": run_id, "state": state, "configVersion": config["configVersion"],
        "startedAt": started_at, "finishedAt": utc_now(), "cycleCount": len(results), "failureCount": len(failures),
        "lastError": failures[0]["error"] if failures else None, "summary": summary,
    })
    if not args.quiet:
        print(json.dumps(summary, indent=2, sort_keys=True))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
