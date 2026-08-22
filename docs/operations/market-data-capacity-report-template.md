# Market Data Capacity Pilot Report

Record a completed local pilot before expanding the market universe, enabling depth-delta capture, or setting any production disk budget. This template deliberately contains no projected storage allocation: capacity decisions must use measured local evidence.

## Pilot scope

| Field | Recorded value |
|---|---|
| UTC pilot start | |
| UTC pilot end | |
| Deployment host and storage class | |
| Symbols | BTC/USDT, ETH/USDT, BNB/USDT (or documented subset) |
| Enabled streams | AGG_TRADE, BOOK_TICKER, KLINE_UPDATE |
| Collector version / image digest | |
| Writer version / image digest | |
| ClickHouse retention configuration | |
| SeaweedFS archive bucket | |

## Measured ingestion and storage

| Metric | Value | Collection method |
|---|---:|---|
| Raw public event count | | ClickHouse `market_events` count |
| NDJSON spool bytes | | Spool volume measurement |
| Parquet archive bytes | | Verified archive object totals |
| ClickHouse bytes | | ClickHouse system table measurement |
| Archive upload lag p50 | | Manifest creation time minus partition end |
| Archive upload lag p95 | | Manifest creation time minus partition end |
| Replay query p50 | | Bounded replay API benchmark |
| Replay query p95 | | Bounded replay API benchmark |
| Collector reconnect count | | COLLECTOR health/audit history |
| Observed data-loss count | | Reconciliation and gap review |

## Acceptance record

| Gate | Result | Evidence or explanation |
|---|---|---|
| All archive manifest checksums verified | | |
| One archived hour staged through restore procedure | | |
| ClickHouse replay returned stable `(exchange_event_time, event_id)` ordering | | |
| Live observations remained `LIVE_UNCONFIRMED` | | |
| No exchange private credentials were configured | | |
| Data-store ports remained internal | | |

> A 24-hour three-symbol stream soak and Docker image build must be run on a host with Docker and outbound network access. Do not mark this report complete using synthetic fixtures alone.
