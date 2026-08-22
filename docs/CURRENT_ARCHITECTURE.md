# Current Architecture

## Scope and boundaries

CryptoSignal researches public crypto-market data for **BTC/USDT, ETH/USDT, and BNB/USDT**. It produces evidence-backed, signals-only outputs from two separate paths: confirmed closed-candle analysis and explicitly unconfirmed live observation. It does not trade, access user accounts, use exchange API keys, manage portfolios, or make individualized recommendations.

> **A `LIVE_UNCONFIRMED` observation is not a confirmed closed-candle signal.** It must never overwrite, suppress, or generate a confirmed signal or its alert.

## Runtime architecture

| Layer | Current responsibility | Storage or transport boundary |
|---|---|---|
| Browser dashboard | Authenticated signal history, chart evidence, focused Research/Live monitor/Controls workspaces, controls for confirmed and live alerts, cache state, and audit history. | Uses protected tRPC only. |
| On-demand public quote | A user-triggered current best bid/ask request to Binance’s market-data-only REST endpoint. | No credentials; not persisted; never a collector, evaluator, archival, or replay fallback. |
| Telegram long polling | Optional owner-allowlisted command and alert surface. It uses `getUpdates`; webhooks are not used. | Shares versioned controls with the dashboard. |
| Closed-candle analysis | Freqtrade adapter consumes public spot OHLCV and submits completed-candle evidence. | Persists confirmed signal data through the API. |
| Public live collector | Binance public combined WebSocket streams for trades, book tickers, and configured klines. | Spools before caching; no Binance credentials. |
| Redis | Latest public event snapshot for the dashboard and evaluator. | Internal network only; stale reads are explicit. |
| Evaluator | Deterministic live-condition evaluation and optional live-only Telegram delivery. | Writes only `LIVE_UNCONFIRMED` observations. |
| ClickHouse | Bounded raw-event replay and 90-day warm retention. | Internal network only; raw events do not enter MySQL/TiDB. |
| SeaweedFS | Verified partitioned Parquet archive retention. | S3-compatible internal endpoint only. |
| MySQL/TiDB | Authentication, configuration, audit events, health, live observations, and archive manifests. | Stores control-plane metadata, never raw market events. |
| Optional MCP adapter | Dashboard-confirmed, public-read-only research discovery/invocation behind a strict allowlist. | Disabled by default; isolated from workers and alerts. |

## Market-event lifecycle

1. The collector accepts allowlisted public Binance WebSocket messages and preserves their exchange event time, payload, and deterministic event identity.
2. It fsyncs each normalized event to the local NDJSON spool before writing the Redis latest-event cache.
3. The writer inserts a spool segment into ClickHouse, creates partitioned Parquet payloads, uploads and verifies SeaweedFS objects, then records all archive manifests before acknowledging the segment.
4. The evaluator reads only Redis snapshots and records condition evidence with `LIVE_UNCONFIRMED`. Its cooldown is independent from confirmed closed-candle alerts.
5. The replay API reads only ClickHouse within an enforced seven-day, 5,000-event maximum window. It has no public REST or exchange fallback.
6. The dashboard may separately request a current public book ticker only when a user selects **Refresh quote**. Its response is labelled on-demand, is not treated as a durable event, and cannot repair or mask a missing Redis collector cache.

## Control model

The dashboard and Telegram are equal, synchronized control surfaces. Both can read shared configuration; dashboard protected procedures and allowlisted Telegram commands may update versioned controls. Confirmed signal alert settings remain separate from `liveAlerts`, which contains only live-condition enablement, selected condition IDs, threshold, and cooldown.

The optional MCP route is not called by page load, polling worker, collector, writer, evaluator, or Telegram. A dashboard request must explicitly provide confirmation, and the requested tool must appear in the exact configured public allowlist. Order, account, wallet, transfer, portfolio, and credential-like names or arguments are rejected before any network request.

## Operations and recovery

Compose profiles keep data services internal: `market-live` runs Redis, collector, and evaluator; `market-retain` runs ClickHouse, SeaweedFS, and writer; `mcp-research` is optional and disabled by default. The production guide documents non-destructive backup, empty-directory restore staging, and local or remote archive checksum verification. A measured three-symbol pilot is required before setting a storage budget or expanding streams.

Docker Compose rendering, image builds, a backup/restore drill, and a 24-hour stream soak remain host-side acceptance gates because they require Docker and outbound network access.
