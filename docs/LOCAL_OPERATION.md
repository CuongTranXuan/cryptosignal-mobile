# Local Operation and Runtime Boundary

## Current implementation

The system now includes a pinned **Freqtrade 2026.7** signals-only adapter, a public Binance Spot closed-candle runner, authenticated signal ingestion, a PostgreSQL-backed snapshot/audit store, a Telegram **long-polling** worker, and an Expo read-only companion. It has no order-placement code, no exchange private-key fields, and no webhook endpoint for Telegram.

## Development commands

Run the API independently of Metro so the command-line engine remains available if the mobile bundler reconnects.

```bash
pnpm dev:api
pnpm dev:metro
```

Verify the pinned Freqtrade setup and run the deterministic strategy test:

```bash
freqtrade --version
freqtrade show-config --config engines/freqtrade/config/signals-only.json --userdir engines/freqtrade/user_data
PYTHONPATH=engines/freqtrade pytest -q engines/freqtrade/tests/test_strategy_contract.py
```

Run one real public-data analysis cycle. The default output is JSON only and does not write to the application database:

```bash
python3 engines/freqtrade/run_signal_cycle.py --symbol BTC/USDT --timeframe 1h --limit 260
```

When the API listener is available, persist the immutable snapshot and apply the alert policy:

```bash
python3 engines/freqtrade/run_signal_cycle.py --symbol BTC/USDT --timeframe 1h --limit 260 --submit
```

Run the Telegram-owned watchlist and timeframes as a single signals-only cycle:

```bash
python3 engines/freqtrade/run_configured_cycle.py
```

## Required server-side environment

| Variable | Role | Client exposure |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Calls `getUpdates`, `getMe`, and `sendMessage` from the server worker. | Never expose. |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated numeric user IDs allowed to issue Telegram controls or receive alerts. | Never expose. |
| `SIGNAL_INGEST_TOKEN` | Authenticates the Freqtrade runner to the HTTP ingestion route. | Never expose. |
| `CRYPTO_SIGNAL_API_BASE_URL` | Optional runner target when the engine and API live on separate hosts. | Engine host only. |

The obsolete `TELEGRAM_WEBHOOK_SECRET` is unused in the long-polling design. Do not configure a Telegram webhook.

Before alerts can be delivered, each allowed Telegram user must open the bot and send `/start`; Telegram does not allow a bot to initiate a private conversation. A failed delivery is recorded in the audit log and must never terminate the API or discard a persisted signal snapshot.

## Durable operation

The managed mobile preview and sandbox support development validation only. A usable recurring service requires an always-on process to keep the Telegram `getUpdates` worker running and to schedule the closed-candle command-line cycle. Use a persistent Linux host that can install Python, Freqtrade 2026.7, and Node; configure the API base URL and server secrets there. The host does not need a public inbound webhook URL.

> Do not schedule or expose any order-execution process. The only approved job is the signals-only runner with `--submit`, which posts completed-candle research snapshots to the application API.
