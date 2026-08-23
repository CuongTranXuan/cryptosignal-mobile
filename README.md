# CryptoSignal

Signals-only crypto market research dashboard. The app evaluates completed public OHLCV candles, records immutable evidence, and displays it in a password-protected browser UI.

> **No orders are placed.** There are no exchange private keys, portfolio features, or trade execution paths.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
- Enough disk for images, MySQL, and optional market-data volumes

## Quick start

From the repo root:

```bash
pnpm docker:up
```

On first run this:

1. Creates `.env` from `.env.example` if missing
2. Starts MySQL
3. Applies database migrations
4. Builds and starts the web API on `http://127.0.0.1:3000`

Open the dashboard, then create the first administrator account using the bootstrap token from `.env` (`DASHBOARD_BOOTSTRAP_TOKEN`).

Stop everything:

```bash
pnpm docker:down
```

## Optional profiles

Add profiles to the same command:

```bash
pnpm docker:up -- --with-runner
pnpm docker:up -- --with-telegram
pnpm docker:up -- --with-market-live
pnpm docker:up -- --with-market-live --with-market-retain
pnpm docker:up -- --with-mcp-research
```

| Profile | What it adds |
|---|---|
| `runner` | Closed-candle Freqtrade analysis cycle every 5 minutes |
| `telegram` | Owner-allowlisted Telegram long polling (set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` in `.env`) |
| `market-live` | Public Binance WebSocket collector, Redis cache, live evaluator |
| `market-retain` | ClickHouse replay store, SeaweedFS archive, event writer |
| `mcp-research` | Optional public read-only MCP adapter (disabled by default) |

## Environment

Local settings live in `.env` at the repo root. Start from `.env.example`:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string (`mysql` hostname inside Compose) |
| `DASHBOARD_BOOTSTRAP_TOKEN` | One-time first-admin setup key (≥ 32 characters) |
| `SIGNAL_INGEST_TOKEN` | Token for closed-candle ingest from the runner |
| `TELEGRAM_*` | Required only for `--with-telegram` |

MySQL is exposed on `127.0.0.1:3306` for local tools. Override the bind with `CRYPTO_SIGNAL_MYSQL_BIND`.

## Verification

```bash
pnpm test:docker
```

Runs type-check, lint, Vitest contracts, Freqtrade strategy contract, and script validation inside Docker.

## TradingView closed-candle visualizer

The repository includes a signals-only Pine Script v6 indicator at [`tradingview/CryptoSignalClosedCandleVisualizer.pine`](tradingview/CryptoSignalClosedCandleVisualizer.pine). Paste it into TradingView’s Pine Editor to draw CryptoSignal-style closed-candle setup behavior on a matching spot chart and timeframe. It is an **indicator, not a strategy**: it cannot place orders, access this application, or modify its shared controls.

See [`docs/TRADINGVIEW_VISUALIZER.md`](docs/TRADINGVIEW_VISUALIZER.md) for installation, score mapping, TA-Lib parity boundaries, and closed-bar alert setup.

## Schema changes

After editing `drizzle/schema.ts`:

```bash
pnpm drizzle-kit generate
# Review drizzle/<new_migration>.sql
pnpm docker:up
```

`docker:up` reapplies migrations against the local MySQL container.

## Architecture

| Component | Role |
|---|---|
| `web` | Express/tRPC API, static browser dashboard, sessions |
| `mysql` | Credentials, sessions, signals, candles, audit events |
| `runner` | Public-market closed-candle analysis (optional) |
| `poller` | Telegram long polling (optional, one instance per bot token) |
| `market-live` / `market-retain` | Public live-market collection and retention (optional) |

## Conventions

Read [`AGENTS.md`](AGENTS.md) for security boundaries, migration workflow, and the source-of-truth file map.
