# Binance Public Real-Time Market Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-hosted, public-only Binance market-data subsystem that delivers live unconfirmed observations, retains replayable raw data for at least two years, and preserves the existing closed-candle signals-only pipeline.

**Architecture:** The production data plane is a public Binance Spot WebSocket collector that writes a local append-only spool and a Redis latest-state cache. A separate writer persists idempotent events to ClickHouse and verified Parquet archives in self-hosted SeaweedFS; the existing MySQL/TiDB store remains the control plane. A live evaluator produces explicitly `LIVE_UNCONFIRMED` observations, while the current closed-candle runner remains the only confirmed-research path.

**Tech Stack:** Node.js 22, TypeScript, Expo web, Express/tRPC, Drizzle/MySQL or TiDB, Vitest, Redis 7, ClickHouse, SeaweedFS, Docker Compose, `ws`, `ioredis`, `@clickhouse/client`, `@aws-sdk/client-s3`, and `parquetjs-lite`.

**Spec:** `docs/2026-08-22-binance-public-realtime-design.md`

## Global Constraints

- Only public Binance Spot market data is in scope. Never request, store, pass, or log Binance API keys, account credentials, private account data, user streams, orders, balances, transfers, or trading actions.
- BTC/USDT, ETH/USDT, and BNB/USDT are the only supported live symbols in the first release. Aggregate trades, best bid/ask, and 30m/1h/4h kline updates are the initial stream allowlist. Depth deltas remain disabled.
- Binance WebSocket Streams are the continuous source of truth. REST is limited to bootstrap and repair. Binance MCP is optional, public-read-only, and must never be in the ingest critical path.
- Use `LIVE_UNCONFIRMED` for every open-candle or microstructure observation. Only completed candles may enter the current `PUBLIC_CLOSED_CANDLES` / Freqtrade confirmation flow.
- All live dashboard and Telegram output must state **“Unconfirmed live market observation”** and **“Signals-only; no order was placed; not personal financial advice.”**
- Do not add a webhook. Telegram remains long polling only.
- Run Redis, ClickHouse, SeaweedFS, collector, writer, evaluator, and optional MCP adapter on an internal Compose network. Publish only the web/API port.
- Write every new durable event path as at-least-once plus idempotent. Do not discard a spool segment until ClickHouse acknowledgement and SeaweedFS manifest verification both succeed.
- Keep every service runnable locally or on a VPS with Compose. Do not introduce managed-cloud, proprietary queue, or private exchange dependency.
- Preserve the existing demo sign-in, English/Vietnamese UI, named closed-candle patterns, methodology toggles, and browser/Telegram shared-control model.

---

## Phase Map

| Phase | Outcome | Review gate |
|---|---|---|
| 0 | Typed contracts, control-plane migration, deterministic fixtures | No external connection starts by default |
| 1 | Local Redis/ClickHouse/SeaweedFS foundations and durable spool | Container health and restart recovery tests pass |
| 2 | Public collector, normalization, cache, and verified writer | Controlled disconnect and archive-retry tests pass |
| 3 | Replay API, live evaluator, dashboard, and Telegram controls | Live and confirmed paths demonstrably remain separate |
| 4 | Optional public MCP adapter and operational hardening | Denylist, backup/restore, and soak evidence pass |

## File Structure and Interfaces

| Path | Responsibility |
|---|---|
| `shared/live-market-types.ts` | Canonical event, observation, health, replay, and live-control types shared by browser and server. |
| `server/market-data/config.ts` | Strict environment parsing and source/stream/symbol allowlists. |
| `server/market-data/normalize.ts` | Binance combined-stream validation, canonical symbol mapping, stable event identity, and lossless normalized event creation. |
| `server/market-data/spool.ts` | Append-only NDJSON segment writer, verified segment reader, checkpoints, and safe deletion. |
| `server/market-data/redis-cache.ts` | Redis key names, cache writes, latest-state reads, and closed-kline notification channels. |
| `server/market-data/binance-collector.ts` | Public WebSocket lifecycle, planned rotation, reconnect backoff, stale detection, and REST repair orchestration. |
| `server/market-data/event-writer.ts` | Idempotent ClickHouse batches, Parquet conversion, SeaweedFS upload, and manifest commit. |
| `server/market-data/replay.ts` | Bounded ClickHouse replay queries and deterministic event ordering. |
| `server/market-data/live-evaluator.ts` | Deterministic unconfirmed condition evaluation and observation identity. |
| `server/market-data/live-alerts.ts` | Live-specific cooldown check, audit trail, and dashboard/Telegram delivery shaping. |
| `server/market-data/mcp-public-client.ts` | Explicitly optional MCP transport, discovery, public tool allowlist, denylist, and audit result. |
| `scripts/run-market-collector.ts` | Worker entrypoint for `market-collector`. |
| `scripts/run-event-writer.ts` | Worker entrypoint for `event-writer`. |
| `scripts/run-live-evaluator.ts` | Worker entrypoint for `live-evaluator`. |
| `infra/clickhouse/init/001_market_events.sql` | ClickHouse tables, materialized bar view, deduplication keys, and 90-day warm retention. |
| `infra/seaweedfs/filer.toml` | Local SeaweedFS filer metadata configuration. |
| `infra/docker-compose.yml` | Existing deployment topology extended with `market-live`, `market-retain`, and `mcp-research` profiles. |
| `tests/market-data/*.test.ts` | Fixture-driven contract, spool, collector, writer, evaluator, replay, and MCP-denylist coverage. |

### Canonical interfaces

Every later task uses the following names and shapes. Do not rename fields in only one layer.

```ts
export const LIVE_STREAM_TYPES = ["AGG_TRADE", "BOOK_TICKER", "KLINE_UPDATE"] as const;
export type LiveStreamType = (typeof LIVE_STREAM_TYPES)[number];
export type LiveDataQualityState = "LIVE_UNCONFIRMED";

export type LiveMarketEvent = {
  eventId: string;
  schemaVersion: 1;
  venue: "BINANCE_PUBLIC";
  streamType: LiveStreamType;
  assetSymbol: "BTC/USDT" | "ETH/USDT" | "BNB/USDT";
  exchangeEventTime: string;
  ingestedAt: string;
  sourceConnectionId: string;
  isClosedCandle: boolean;
  integrityHash: string;
  payload: Record<string, string | number | boolean | null>;
};

export type LiveObservation = {
  id: string;
  assetSymbol: LiveMarketEvent["assetSymbol"];
  observedAt: string;
  conditionId: "PRICE_DISPLACEMENT_V1" | "SPREAD_ANOMALY_V1" | "TRADE_FLOW_IMBALANCE_V1" | "OPEN_CANDLE_THRESHOLD_V1";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  score: number;
  dataQualityState: "LIVE_UNCONFIRMED";
  evidence: Record<string, number | string | boolean>;
  sourceEventIds: string[];
  configVersion: number;
};

export type MarketComponentHealth = {
  component: "COLLECTOR" | "WRITER" | "EVALUATOR" | "MCP";
  state: "IDLE" | "RUNNING" | "DEGRADED" | "FAILED";
  lastSuccessAt: Date | null;
  lastError: string | null;
  lagMs: number | null;
  summary: Record<string, unknown>;
  updatedAt: Date | null;
};
```

---

### Task 1: Add typed live-market contracts, dependencies, and deterministic fixtures

**Files:**
- Create: `shared/live-market-types.ts`
- Create: `tests/market-data/fixtures/binance-combined-streams.ts`
- Create: `tests/market-data/contracts.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `LiveMarketEvent`, `LiveObservation`, `MarketComponentHealth`, `LIVE_STREAM_TYPES`, and `LIVE_CONDITION_IDS`.
- Consumes: Existing `BotConfigView` from `shared/signal-types.ts` in later configuration extensions.

- [ ] **Step 1: Write failing contract tests for the canonical event and observation vocabulary.**

```ts
import { describe, expect, it } from "vitest";
import { LIVE_CONDITION_IDS, LIVE_STREAM_TYPES } from "../../shared/live-market-types";

describe("live market contracts", () => {
  it("keeps only the approved initial stream types and live conditions", () => {
    expect(LIVE_STREAM_TYPES).toEqual(["AGG_TRADE", "BOOK_TICKER", "KLINE_UPDATE"]);
    expect(LIVE_CONDITION_IDS).toEqual([
      "PRICE_DISPLACEMENT_V1",
      "SPREAD_ANOMALY_V1",
      "TRADE_FLOW_IMBALANCE_V1",
      "OPEN_CANDLE_THRESHOLD_V1",
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails because the live contract module does not exist.**

Run: `pnpm vitest run tests/market-data/contracts.test.ts`

Expected: FAIL with a module-resolution error for `shared/live-market-types`.

- [ ] **Step 3: Add the contract module and fixed public-source fixtures.**

Implement the canonical interfaces above, plus `LIVE_CONDITION_IDS`, `LiveConditionId`, `LiveAlertConfig`, `LiveReplayWindow`, and `LiveMarketSnapshot`. Put three frozen combined-stream payloads in the fixture file: one `aggTrade` for BTCUSDT, one `bookTicker` for ETHUSDT, and one nonclosed 30m kline for BNBUSDT. Use real Binance field names in the fixture and no credentials.

- [ ] **Step 4: Add only the required runtime dependencies.**

Add exact dependencies with `pnpm add ws ioredis @clickhouse/client @aws-sdk/client-s3 parquetjs-lite`. Do not add a queue, browser WebSocket library, Binance SDK, or account-oriented client.

- [ ] **Step 5: Run focused and repository checks.**

Run: `pnpm vitest run tests/market-data/contracts.test.ts && pnpm check`

Expected: PASS with the approved three stream types and four live condition IDs only.

- [ ] **Step 6: Commit the self-contained contract foundation.**

```bash
git add shared/live-market-types.ts tests/market-data/fixtures/binance-combined-streams.ts tests/market-data/contracts.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add public live market contracts"
```

### Task 2: Extend the control plane for isolated live-alert configuration and health

**Files:**
- Modify: `shared/signal-types.ts`
- Modify: `drizzle/schema.ts`
- Create: `drizzle/0007_live_market_controls.sql` and generated Drizzle metadata
- Modify: `server/db.ts`
- Create: `tests/market-data/live-config-db.test.ts`

**Interfaces:**
- Consumes: `LiveConditionId`, `MarketComponentHealth` from Task 1.
- Produces: `BotConfigView.liveAlerts`, `getMarketPipelineHealth()`, `recordMarketPipelineHealth()`, `recordLiveObservation()`, `listLiveObservations()`, and `hasRecentLiveAlert()`.

- [ ] **Step 1: Write failing persistence tests that prove live controls do not alter confirmed controls.**

```ts
it("persists live cooldown independently from confirmed cooldown", async () => {
  const next = await updateBotConfig({
    liveAlerts: { enabled: true, conditionIds: ["PRICE_DISPLACEMENT_V1"], threshold: 0.72, cooldownMinutes: 15 },
  }, "dashboard", DEFAULT_BOT_CONFIG, "DASHBOARD");
  expect(next.cooldownMinutes).toBe(60);
  expect(next.liveAlerts.cooldownMinutes).toBe(15);
});
```

- [ ] **Step 2: Run the focused test and verify it fails because `liveAlerts` is absent.**

Run: `pnpm vitest run tests/market-data/live-config-db.test.ts`

Expected: FAIL with `liveAlerts` missing from `BotConfigView`.

- [ ] **Step 3: Add configuration fields and MySQL/TiDB tables.**

Add `liveAlertsJson` to `bot_configs`. Its default is `{ enabled: false, conditionIds: [], threshold: 0.65, cooldownMinutes: 15 }`. Create these control-plane tables:

```ts
liveObservations: {
  id: varchar("id", { length: 96 }).primaryKey(),
  assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
  observedAt: timestamp("observedAt").notNull(),
  conditionId: varchar("conditionId", { length: 64 }).notNull(),
  direction: varchar("direction", { length: 16 }).notNull(),
  score: double("score").notNull(),
  dataQualityState: varchar("dataQualityState", { length: 32 }).notNull(),
  evidenceJson: text("evidenceJson").notNull(),
  sourceEventIdsJson: text("sourceEventIdsJson").notNull(),
  configVersion: int("configVersion").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}

marketPipelineHealth: {
  component: varchar("component", { length: 24 }).primaryKey(),
  state: varchar("state", { length: 24 }).notNull(),
  lastSuccessAt: timestamp("lastSuccessAt"),
  lastError: text("lastError"),
  lagMs: int("lagMs"),
  summaryJson: text("summaryJson").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}

marketArchiveManifests: {
  id: varchar("id", { length: 96 }).primaryKey(),
  streamType: varchar("streamType", { length: 24 }).notNull(),
  assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
  partitionStart: timestamp("partitionStart").notNull(),
  partitionEnd: timestamp("partitionEnd").notNull(),
  objectKey: varchar("objectKey", { length: 512 }).notNull().unique(),
  rowCount: int("rowCount").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  clickhouseBatchId: varchar("clickhouseBatchId", { length: 96 }).notNull(),
  state: varchar("state", { length: 24 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}
```

Add indexes on `(assetSymbol, observedAt)` for `liveObservations` and `(state, updatedAt)` for `marketPipelineHealth`. Generate and inspect the Drizzle migration; apply it only through the established `pnpm db:push` workflow.

- [ ] **Step 4: Implement read/write helpers and auditable live deduplication.**

`hasRecentLiveAlert(alertKey, cooldownMinutes)` must inspect only `LIVE_OBSERVATION_ALERT_SENT` audit events. It must not reuse `SIGNAL_ALERT_SENT`, preventing a live cooldown from suppressing a confirmed closed-candle alert. `recordLiveObservation` must reject duplicate IDs and add `LIVE_OBSERVATION_RECORDED` audit metadata without raw payloads.

- [ ] **Step 5: Re-run focused tests and migration validation.**

Run: `pnpm vitest run tests/market-data/live-config-db.test.ts && pnpm drizzle-kit generate && pnpm check`

Expected: PASS; generated SQL only adds `liveAlertsJson` and the three live-market control-plane tables.

- [ ] **Step 6: Commit the database/control-plane change.**

```bash
git add shared/signal-types.ts drizzle server/db.ts tests/market-data/live-config-db.test.ts
git commit -m "feat: add live observation controls and health state"
```

### Task 3: Create self-hosted Compose foundations without starting Binance ingestion

**Files:**
- Modify: `infra/docker-compose.yml`
- Create: `infra/clickhouse/init/001_market_events.sql`
- Create: `infra/seaweedfs/filer.toml`
- Modify: `infra/cryptosignal.env.example`
- Create: `tests/market-data/compose-contract.test.ts`

**Interfaces:**
- Produces: Compose profiles `market-live`, `market-retain`, and `mcp-research`.
- Produces: ClickHouse `market_events` and `market_bars_1m` tables.

- [ ] **Step 1: Write failing text-contract tests for local service isolation.**

```ts
it("keeps Redis, ClickHouse, and SeaweedFS off published host ports", () => {
  expect(compose).toContain('profiles: ["market-retain"]');
  expect(compose).not.toMatch(/clickhouse:[\s\S]*?ports:/);
  expect(compose).not.toMatch(/redis:[\s\S]*?ports:/);
  expect(compose).not.toMatch(/seaweedfs:[\s\S]*?ports:/);
});
```

- [ ] **Step 2: Run the test and verify it fails before the profiles exist.**

Run: `pnpm vitest run tests/market-data/compose-contract.test.ts`

Expected: FAIL because `market-retain` is absent.

- [ ] **Step 3: Add local-only services and health checks.**

Add `redis` to the `market-live` profile using `redis:7.4-alpine`, `clickhouse` to `market-retain` using `clickhouse/clickhouse-server`, and `seaweedfs` to `market-retain` using `chrislusf/seaweedfs`. Give each named persistent volumes and a health check. Attach all to a new internal `market-internal` network with `internal: true`; do not add `ports:` entries.

Add these ClickHouse definitions:

```sql
CREATE TABLE IF NOT EXISTS market_events (
  event_id String, venue LowCardinality(String), stream_type LowCardinality(String),
  asset_symbol LowCardinality(String), exchange_event_time DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC'), source_connection_id String,
  is_closed_candle UInt8, integrity_hash FixedString(64), payload_json String
) ENGINE = ReplacingMergeTree
PARTITION BY toDate(exchange_event_time)
ORDER BY (venue, stream_type, asset_symbol, exchange_event_time, event_id)
TTL exchange_event_time + INTERVAL 90 DAY DELETE;

CREATE MATERIALIZED VIEW IF NOT EXISTS market_bars_1m
ENGINE = SummingMergeTree
PARTITION BY toDate(minute)
ORDER BY (asset_symbol, minute)
AS SELECT asset_symbol, toStartOfMinute(exchange_event_time) AS minute,
  min(JSONExtractFloat(payload_json, 'price')) AS low,
  max(JSONExtractFloat(payload_json, 'price')) AS high,
  argMin(JSONExtractFloat(payload_json, 'price'), exchange_event_time) AS open,
  argMax(JSONExtractFloat(payload_json, 'price'), exchange_event_time) AS close,
  count() AS event_count
FROM market_events WHERE stream_type = 'AGG_TRADE'
GROUP BY asset_symbol, minute;
```

Document all values in `infra/cryptosignal.env.example`: internal Redis URL, ClickHouse URL, SeaweedFS S3 endpoint/bucket/access key/secret, local spool directory, and worker interval. These are service-local credentials, not Binance credentials.

- [ ] **Step 4: Run configuration checks.**

Run: `pnpm vitest run tests/market-data/compose-contract.test.ts && docker compose -f infra/docker-compose.yml --profile market-live --profile market-retain config >/dev/null`

Expected: PASS; rendered Compose has no externally published data-store ports.

- [ ] **Step 5: Commit the local service foundation.**

```bash
git add infra/docker-compose.yml infra/clickhouse infra/seaweedfs infra/cryptosignal.env.example tests/market-data/compose-contract.test.ts
git commit -m "feat: add local market data storage profiles"
```

### Task 4: Build the append-only spool with recovery-safe segment lifecycle

**Files:**
- Create: `server/market-data/spool.ts`
- Create: `tests/market-data/spool.test.ts`

**Interfaces:**
- Produces: `createMarketSpool(options)`, with `append(event)`, `listPendingSegments()`, `readSegment(path)`, `markSegmentArchived(segment, manifestId)`, and `recover()`.
- Consumes: `LiveMarketEvent` from Task 1.

- [ ] **Step 1: Write failing recovery tests using a temporary directory.**

```ts
it("retains a segment until both writer acknowledgements are recorded", async () => {
  const spool = await createMarketSpool({ directory: tempDir, maxBytes: 128, maxAgeMs: 60_000 });
  await spool.append(eventFixture);
  const [segment] = await spool.listPendingSegments();
  await spool.markClickHouseCommitted(segment.path, "batch-1");
  expect(await exists(segment.path)).toBe(true);
  await spool.markSegmentArchived(segment.path, "manifest-1");
  expect(await exists(segment.path)).toBe(false);
});
```

- [ ] **Step 2: Run the spool test and verify it fails because the module is absent.**

Run: `pnpm vitest run tests/market-data/spool.test.ts`

Expected: FAIL with a missing `createMarketSpool` export.

- [ ] **Step 3: Implement NDJSON segments and atomic checkpoint files.**

Serialize one canonical JSON event per newline. Rotate a segment at `MARKET_SPOOL_MAX_BYTES` or `MARKET_SPOOL_MAX_AGE_MS`. Store acknowledgement state in an adjacent `.state.json` written by atomic rename. `recover()` must enumerate `.ndjson` files in lexicographic order, ignore malformed partial final lines, and retain every segment without both `clickhouseBatchId` and `archiveManifestId`.

- [ ] **Step 4: Add corruption and restart tests.**

Add tests proving that a trailing partial line does not erase prior valid records, that a second `append()` after restart keeps monotonic segment ordering, and that an event is never dropped by `markClickHouseCommitted` alone.

- [ ] **Step 5: Run focused tests and commit.**

Run: `pnpm vitest run tests/market-data/spool.test.ts && pnpm check`

```bash
git add server/market-data/spool.ts tests/market-data/spool.test.ts
git commit -m "feat: add durable market event spool"
```

### Task 5: Normalize public Binance combined streams and cache the latest state

**Files:**
- Create: `server/market-data/normalize.ts`
- Create: `server/market-data/redis-cache.ts`
- Create: `tests/market-data/normalize.test.ts`
- Create: `tests/market-data/redis-cache.test.ts`

**Interfaces:**
- Produces: `normalizeBinanceCombinedStream(input, context): LiveMarketEvent | null`, `createEventId(event)`, `createMarketCache(client)`, `writeLatest(event)`, `readSnapshot(symbol)`.
- Consumes: Captured stream fixtures from Task 1.

- [ ] **Step 1: Write failing normalizer tests for approved, rejected, and closed-kline events.**

```ts
it("maps a public BTCUSDT aggregate trade to the canonical shape", () => {
  const event = normalizeBinanceCombinedStream(aggTradeFixture, context);
  expect(event).toMatchObject({ streamType: "AGG_TRADE", assetSymbol: "BTC/USDT", venue: "BINANCE_PUBLIC" });
  expect(event?.eventId).toMatch(/^[a-f0-9]{64}$/);
});

it("rejects unknown symbols and stream names", () => {
  expect(normalizeBinanceCombinedStream(unknownStreamFixture, context)).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify the normalizer/cache modules do not exist.**

Run: `pnpm vitest run tests/market-data/normalize.test.ts tests/market-data/redis-cache.test.ts`

Expected: FAIL with import errors.

- [ ] **Step 3: Implement lossless normalization and deterministic identity.**

Use `zod` schemas for only the three allowed payload forms. Map `BTCUSDT`, `ETHUSDT`, and `BNBUSDT` to canonical slash symbols; return `null` for every other symbol or event. Compute `integrityHash` using SHA-256 of a stable JSON serialization and compute `eventId` from venue, stream type, symbol, exchange event time, source sequence/trade ID, and integrity hash. Preserve numeric source fields as strings in `payload`; never convert money values to binary floating point while normalizing.

- [ ] **Step 4: Implement Redis cache keys and expiry.**

Use keys `market:latest:{symbol}:trade`, `market:latest:{symbol}:book`, and `market:latest:{symbol}:kline:{timeframe}` with an explicit 10-minute TTL. `readSnapshot()` returns a `LiveMarketSnapshot` with `stale: true` when its freshest source time is older than `MARKET_STALE_AFTER_MS`. Redis failure must throw a typed `MarketCacheUnavailableError`; callers will continue spooling but stop live evaluation.

- [ ] **Step 5: Run focused tests and commit.**

Run: `pnpm vitest run tests/market-data/normalize.test.ts tests/market-data/redis-cache.test.ts && pnpm check`

```bash
git add server/market-data/normalize.ts server/market-data/redis-cache.ts tests/market-data
git commit -m "feat: normalize and cache public market events"
```

### Task 6: Implement the public WebSocket collector with safe lifecycle and closed-kline notice

**Files:**
- Create: `server/market-data/config.ts`
- Create: `server/market-data/binance-collector.ts`
- Create: `scripts/run-market-collector.ts`
- Create: `tests/market-data/binance-collector.test.ts`
- Modify: `infra/docker-compose.yml`

**Interfaces:**
- Produces: `createBinanceCollector(deps)`, `start()`, `stop()`, `getHealth()`.
- Consumes: `normalizeBinanceCombinedStream`, market spool, market cache, and `recordMarketPipelineHealth`.

- [ ] **Step 1: Write failing fake-WebSocket tests for the full collector lifecycle.**

```ts
it("spools before caching and records a closed-kline notice without confirming it", async () => {
  const collector = createBinanceCollector(depsWithFakeSocket());
  await collector.start();
  fakeSocket.emitMessage(openKlineFixture);
  await flushPromises();
  expect(spool.append).toHaveBeenCalledBefore(cache.writeLatest as never);
  expect(recordAuditEvent).toHaveBeenCalledWith("LIVE_KLINE_CLOSED", "MARKET_COLLECTOR", "binance-public", expect.any(Object));
  expect(recordSignalSnapshot).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and verify it fails before implementation.**

Run: `pnpm vitest run tests/market-data/binance-collector.test.ts`

Expected: FAIL because `createBinanceCollector` is undefined.

- [ ] **Step 3: Implement allowlisted combined-stream subscription and recovery.**

Create the stream URL from only configured watchlist symbols and timeframes: `@aggTrade`, `@bookTicker`, and `@kline_{timeframe}`. Use `wss://stream.binance.com:9443/stream?streams=...`; reject an env override unless it is the documented public WSS origin or a test URL. Generate a new `sourceConnectionId` per connection. Rotate before 23 hours 50 minutes, reconnect with exponential backoff capped at 60 seconds, and mark collector health `DEGRADED` while stale.

For every valid event, execute `spool.append(event)` before `cache.writeLatest(event)`. A Redis failure records degraded health but does not stop spool ingestion. On a closed kline (`payload.x === true`), record only `LIVE_KLINE_CLOSED` audit metadata and publish the normalized event ID to `market:closed-kline`; never call a confirmed signal writer here.

- [ ] **Step 4: Add the profile-gated collector service.**

Add `market-collector` to profile `market-live`, dependent on healthy `redis` and `web`, with `MARKET_COLLECTOR_ENABLED=true`, an internal spool volume, and command `node --import tsx scripts/run-market-collector.ts` for development and the compiled equivalent in production. Keep it free of public ports and Binance credentials.

- [ ] **Step 5: Run lifecycle tests and commit.**

Run: `pnpm vitest run tests/market-data/binance-collector.test.ts && pnpm check`

```bash
git add server/market-data/config.ts server/market-data/binance-collector.ts scripts/run-market-collector.ts infra/docker-compose.yml tests/market-data/binance-collector.test.ts
git commit -m "feat: add public Binance market collector"
```

### Task 7: Persist idempotent warm data and verified Parquet archives

**Files:**
- Create: `server/market-data/event-writer.ts`
- Create: `server/market-data/archive.ts`
- Create: `scripts/run-event-writer.ts`
- Create: `tests/market-data/event-writer.test.ts`
- Create: `tests/market-data/archive.test.ts`
- Modify: `infra/docker-compose.yml`

**Interfaces:**
- Produces: `createEventWriter(deps)`, `flushOneSegment()`, `archiveEvents(events)`, `buildArchiveObjectKey(event)`.
- Consumes: Task 4 spool segments, Task 2 manifest helpers, and Task 3 ClickHouse/SeaweedFS services.

- [ ] **Step 1: Write failing idempotency and archive-order tests.**

```ts
it("does not delete a spool segment when SeaweedFS verification fails", async () => {
  s3.headObject.mockRejectedValueOnce(new Error("archive unavailable"));
  await expect(writer.flushOneSegment()).rejects.toThrow("archive verification failed");
  expect(spool.markSegmentArchived).not.toHaveBeenCalled();
});

it("uses a deterministic partitioned object key", () => {
  expect(buildArchiveObjectKey(eventFixture)).toBe(
    "market-events/venue=binance-public/stream=AGG_TRADE/symbol=BTC-USDT/date=2026-08-22/hour=03/events.parquet",
  );
});
```

- [ ] **Step 2: Run tests and verify they fail before the writer exists.**

Run: `pnpm vitest run tests/market-data/event-writer.test.ts tests/market-data/archive.test.ts`

Expected: FAIL with missing writer and archive exports.

- [ ] **Step 3: Implement ClickHouse-first, archive-verified batch flow.**

Read the oldest pending spool segment. Insert `LiveMarketEvent[]` through `@clickhouse/client` into `market_events`, relying on the ReplacingMergeTree event ID key for at-least-once idempotency. Write a Parquet file with the exact normalized envelope columns using `parquetjs-lite`, upload it through `@aws-sdk/client-s3` to the local SeaweedFS endpoint, and verify it with `HeadObjectCommand` content length plus SHA-256 metadata.

After verification, insert `marketArchiveManifests` with state `VERIFIED`, then call `spool.markSegmentArchived(segment.path, manifest.id)`. If ClickHouse or SeaweedFS fails, leave the segment available and set writer health to `DEGRADED`. Never write raw events into MySQL/TiDB.

- [ ] **Step 4: Add writer worker profile and failure tests.**

Add `event-writer` to profile `market-retain`, dependent on healthy `clickhouse` and `seaweedfs`, sharing the collector spool volume. Add tests for ClickHouse retry, duplicate segment replay, content-hash mismatch, and recovery from a preexisting `.state.json` with ClickHouse committed but archive absent.

- [ ] **Step 5: Run focused tests and commit.**

Run: `pnpm vitest run tests/market-data/event-writer.test.ts tests/market-data/archive.test.ts && pnpm check`

```bash
git add server/market-data/event-writer.ts server/market-data/archive.ts scripts/run-event-writer.ts infra/docker-compose.yml tests/market-data
git commit -m "feat: archive live market events locally"
```

### Task 8: Add bounded replay and live-health server APIs

**Files:**
- Create: `server/market-data/replay.ts`
- Modify: `server/db.ts`
- Modify: `server/routers.ts`
- Create: `tests/market-data/replay-router.test.ts`

**Interfaces:**
- Produces: `market.liveSnapshot`, `market.replay`, `market.health`, and `bot.controls.setLiveAlerts` tRPC procedures.
- Produces: `queryReplayWindow({ assetSymbol, from, to, limit }): Promise<LiveMarketEvent[]>`.

- [ ] **Step 1: Write failing protected-router tests for bounded replay and isolated controls.**

```ts
it("limits replay to a seven-day window and 5,000 events", async () => {
  await expect(caller.market.replay({ assetSymbol: "BTC/USDT", from: weekAgo, to: now, limit: 5001 }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("updates only live alert controls", async () => {
  const next = await caller.bot.controls.setLiveAlerts({ enabled: true, conditionIds: ["SPREAD_ANOMALY_V1"], threshold: 0.7, cooldownMinutes: 10 });
  expect(next.liveAlerts.enabled).toBe(true);
  expect(next.alertThreshold).toBe(0.55);
});
```

- [ ] **Step 2: Run tests and verify new routes are absent.**

Run: `pnpm vitest run tests/market-data/replay-router.test.ts`

Expected: FAIL because `market.replay` and `setLiveAlerts` do not exist.

- [ ] **Step 3: Implement defensive APIs.**

`market.liveSnapshot` reads Redis only and returns freshness/staleness fields; it must not query Binance. `market.replay` validates one approved symbol, an ISO window of at most seven days, a maximum of 5,000 events, and a stable `(exchange_event_time, event_id)` order. `market.health` returns `COLLECTOR`, `WRITER`, `EVALUATOR`, and `MCP` rows without secrets. `setLiveAlerts` validates approved condition IDs, threshold `0..1`, and cooldown `1..1440`.

- [ ] **Step 4: Add unit tests for stale cache, query ordering, and unavailable ClickHouse.**

Use a fake Redis client and fake ClickHouse client. Assert that stale cache returns `stale: true`, replay ordering is stable for equal exchange times, and ClickHouse unavailability maps to an auditable `DEGRADED` health response rather than a fallback to public REST.

- [ ] **Step 5: Run tests and commit.**

Run: `pnpm vitest run tests/market-data/replay-router.test.ts && pnpm check`

```bash
git add server/market-data/replay.ts server/db.ts server/routers.ts tests/market-data/replay-router.test.ts
git commit -m "feat: expose live market replay and health"
```

### Task 9: Evaluate unconfirmed conditions and preserve the confirmed-candle boundary

**Files:**
- Create: `server/market-data/live-evaluator.ts`
- Create: `server/market-data/live-alerts.ts`
- Create: `scripts/run-live-evaluator.ts`
- Create: `tests/market-data/live-evaluator.test.ts`
- Create: `tests/market-data/live-alerts.test.ts`
- Modify: `infra/docker-compose.yml`

**Interfaces:**
- Produces: `evaluateLiveSnapshot(snapshot, config, now): LiveObservation[]`, `deliverLiveObservationAlert(observation)`, and `formatLiveObservationAlert(observation)`.
- Consumes: `BotConfigView.liveAlerts`, Redis snapshot, live-observation DB helpers, and Telegram delivery primitive.

- [ ] **Step 1: Write failing tests proving live observations cannot create confirmed signals.**

```ts
it("labels an imbalance observation as unconfirmed and never records a signal snapshot", async () => {
  const observations = evaluateLiveSnapshot(imbalancedSnapshot, enabledLiveConfig, now);
  expect(observations[0]).toMatchObject({ dataQualityState: "LIVE_UNCONFIRMED", conditionId: "TRADE_FLOW_IMBALANCE_V1" });
  await deliverLiveObservationAlert(observations[0]);
  expect(recordSignalSnapshot).not.toHaveBeenCalled();
});

it("does not send a live alert when the live-only cooldown is active", async () => {
  await expect(deliverLiveObservationAlert(observation)).resolves.toMatchObject({ delivered: false, reason: "COOLDOWN" });
});
```

- [ ] **Step 2: Run focused tests and verify they fail before evaluator implementation.**

Run: `pnpm vitest run tests/market-data/live-evaluator.test.ts tests/market-data/live-alerts.test.ts`

Expected: FAIL with missing live evaluator and alert exports.

- [ ] **Step 3: Implement deterministic condition rules.**

Implement only these rules:

```ts
PRICE_DISPLACEMENT_V1: Math.abs((latestPrice - baselinePrice) / baselinePrice) >= threshold;
SPREAD_ANOMALY_V1: ((ask - bid) / ((ask + bid) / 2)) >= threshold;
TRADE_FLOW_IMBALANCE_V1: Math.abs((buyNotional - sellNotional) / (buyNotional + sellNotional)) >= threshold;
OPEN_CANDLE_THRESHOLD_V1: Math.abs((close - open) / open) >= threshold;
```

Derive direction only from signed evidence, create deterministic IDs from condition/symbol/source IDs/time bucket/config version, persist `LIVE_UNCONFIRMED`, and publish audit events. The evaluator must stop on stale/missing cache and record health rather than using REST to fabricate a live result.

- [ ] **Step 4: Implement live-only alert wording and service profile.**

All Telegram text must be created by `formatLiveObservationAlert()` and start with `Unconfirmed live market observation`. It must include the numeric evidence, event time, dashboard route, and exact signals-only disclaimer. Use `hasRecentLiveAlert`; never call `hasRecentSignalAlert`.

Add `live-evaluator` to `market-live`, depending on Redis and web health. It subscribes to cache/closed-update notifications, wakes on a bounded interval, and records component health. It must not subscribe directly to Binance or write archive data.

- [ ] **Step 5: Run tests and commit.**

Run: `pnpm vitest run tests/market-data/live-evaluator.test.ts tests/market-data/live-alerts.test.ts && pnpm check`

```bash
git add server/market-data/live-evaluator.ts server/market-data/live-alerts.ts scripts/run-live-evaluator.ts infra/docker-compose.yml tests/market-data
git commit -m "feat: add unconfirmed live market observations"
```

### Task 10: Add shared dashboard and Telegram controls for live observations

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Create: `components/live-market-panel.tsx`
- Modify: `components/operational-audit-panel.tsx`
- Modify: `lib/i18n.tsx`
- Modify: `server/telegram-polling.ts`
- Create: `tests/live-market-panel.test.tsx`
- Modify: `tests/telegram-polling.test.ts`

**Interfaces:**
- Consumes: `market.liveSnapshot`, `market.replay`, `market.health`, `bot.controls.setLiveAlerts`, `formatLiveObservationAlert`.
- Produces: `/live`, `/live enable`, `/live disable`, `/live threshold 0.70`, and `/live cooldown 15m` Telegram controls.

- [ ] **Step 1: Write failing UI and Telegram command tests.**

```ts
it("renders an explicit unconfirmed badge and never reuses confirmed copy", () => {
  render(<LiveMarketPanel snapshot={snapshot} health={health} />);
  expect(screen.getByText("Unconfirmed live market observation")).toBeTruthy();
  expect(screen.queryByText("Confirmed closed-candle research")).toBeNull();
});

it("updates only live settings through /live cooldown", async () => {
  await handleAllowedText("/live cooldown 15m");
  expect(updateBotConfig).toHaveBeenCalledWith(expect.objectContaining({ liveAlerts: expect.objectContaining({ cooldownMinutes: 15 }) }), expect.any(String), expect.anything());
});
```

- [ ] **Step 2: Run tests and verify the live panel and commands are missing.**

Run: `pnpm vitest run tests/live-market-panel.test.tsx tests/telegram-polling.test.ts`

Expected: FAIL because `LiveMarketPanel` and `/live` handling do not exist.

- [ ] **Step 3: Add dashboard live panel and toggles.**

Place `LiveMarketPanel` above historical chart controls. It renders source freshness, current last trade, best bid/ask, spread, last in-progress kline, latest live observation, and collector/writer/evaluator health. Add a separate **Live observations** control group with enabled toggle, condition toggle grid, threshold rail, and cooldown input. Use dedicated queries/mutations and a 5-second refetch only while the panel is visible. Do not replace current closed-candle controls or present a live observation in `SignalCard`.

Add English and Vietnamese keys for every new label, stale state, and unconfirmed disclaimer. Keep all accessibility labels explicit.

- [ ] **Step 4: Add Telegram controls with strict separation.**

Extend `/help` with `/live [enable|disable]`, `/live conditions`, `/live threshold 0.70`, and `/live cooldown 15m`. `/status` reports confirmed monitoring and live-observation status on separate lines. Preserve the existing long-polling loop and allowed-user checks. Every response that lists a live condition labels it unconfirmed.

- [ ] **Step 5: Add audit-panel health rendering and run tests.**

Display four market components separately from existing runner health, including last successful time, lag, and sanitized error. Do not render raw events, object-store credentials, Redis URL, ClickHouse URL, or MCP headers.

Run: `pnpm vitest run tests/live-market-panel.test.tsx tests/telegram-polling.test.ts && pnpm check && pnpm lint`

- [ ] **Step 6: Commit the dual-surface live controls.**

```bash
git add app/(tabs)/index.tsx components/live-market-panel.tsx components/operational-audit-panel.tsx lib/i18n.tsx server/telegram-polling.ts tests/live-market-panel.test.tsx tests/telegram-polling.test.ts
git commit -m "feat: add live observation dashboard and Telegram controls"
```

### Task 11: Add the optional public-read-only Binance MCP adapter

**Files:**
- Create: `server/market-data/mcp-public-client.ts`
- Modify: `server/routers.ts`
- Create: `tests/market-data/mcp-public-client.test.ts`
- Modify: `infra/docker-compose.yml`
- Modify: `infra/cryptosignal.env.example`

**Interfaces:**
- Produces: `createPublicMcpClient(options)`, `listPublicTools()`, `invokePublicTool(toolName, args)`, and `market.mcpStatus` / `market.mcpResearch`.
- Consumes: `recordMarketPipelineHealth`, `recordAuditEvent`, and dashboard authorization.

- [ ] **Step 1: Write failing denylist-first tests.**

```ts
it.each(["place_order", "account_balance", "transfer", "wallet", "futures_position"])("rejects prohibited MCP tool %s", async (toolName) => {
  await expect(client.invokePublicTool(toolName, {})).rejects.toThrow("MCP tool is not allowed");
  expect(fetch).not.toHaveBeenCalled();
});

it("runs no request when the MCP adapter is disabled", async () => {
  await expect(client.listPublicTools()).resolves.toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify they fail before the adapter exists.**

Run: `pnpm vitest run tests/market-data/mcp-public-client.test.ts`

Expected: FAIL with missing client exports.

- [ ] **Step 3: Implement disabled-by-default discovery and a persisted public allowlist.**

Use `BINANCE_MCP_ENABLED=false` by default and fixed endpoint `https://agent.binance.com/mcp/agentic`. The first enabled operation is discovery only: invoke the MCP `tools/list` transport request, store the sanitized returned tool names in an audit event, and return no market result until the operator records exact permitted public tool names in `BINANCE_MCP_PUBLIC_TOOL_IDS`.

`invokePublicTool` must reject every name not in both the recorded allowlist and the environment allowlist. Strip or reject fields containing `apiKey`, `secret`, `signature`, `order`, `quantity`, `recipient`, `address`, `account`, or `transfer`. Record tool name, public normalized arguments, latency, result status, and no raw response body over the audit size limit. An MCP error sets `MCP` health to `DEGRADED` and returns a typed unavailable result; it cannot affect collector, writer, evaluator, or Telegram workers.

- [ ] **Step 4: Add an optional Compose profile and secured tRPC route.**

Add `mcp-research-adapter` under profile `mcp-research`, without Binance credentials and with no published port. `market.mcpResearch` is dashboard-protected, requires a user-visible confirmation in the dashboard, and is not called automatically by page loads or workers.

- [ ] **Step 5: Run security tests and commit.**

Run: `pnpm vitest run tests/market-data/mcp-public-client.test.ts && pnpm check`

```bash
git add server/market-data/mcp-public-client.ts server/routers.ts infra/docker-compose.yml infra/cryptosignal.env.example tests/market-data/mcp-public-client.test.ts
git commit -m "feat: add optional public MCP research adapter"
```

### Task 12: Add local backup, restore, capacity, and release gates

**Files:**
- Create: `scripts/backup-market-data.sh`
- Create: `scripts/restore-market-data.sh`
- Create: `scripts/verify-market-archive.sh`
- Modify: `scripts/configure-production.sh`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Create: `docs/operations/market-data-capacity-report-template.md`
- Create: `tests/market-data/operations-scripts.test.ts`

**Interfaces:**
- Produces: Local backup archive, restore procedure, manifest verifier, and written pilot metrics report.
- Consumes: SeaweedFS archive manifests, ClickHouse warm store, and Compose profiles.

- [ ] **Step 1: Write failing script-contract tests.**

```ts
it("refuses to run a restore without an explicit destination and archive path", () => {
  expect(run("scripts/restore-market-data.sh")).toMatchObject({ status: 64 });
});

it("requires every verified manifest to match a local object checksum", async () => {
  await expect(verifyManifest(manifestWithWrongHash)).rejects.toThrow("checksum mismatch");
});
```

- [ ] **Step 2: Run the tests and verify scripts do not exist.**

Run: `pnpm vitest run tests/market-data/operations-scripts.test.ts`

Expected: FAIL because the operations scripts are absent.

- [ ] **Step 3: Implement non-destructive operational scripts.**

`backup-market-data.sh` must create timestamped tar archives of Compose configuration, SeaweedFS data volume export, ClickHouse backup output, and the market manifest ledger dump. `restore-market-data.sh` must require `--source` and `--target-empty-dir`, refuse a nonempty target, and print the exact restore plan before copying data. `verify-market-archive.sh` must list verified manifests, `HeadObject` every SeaweedFS object, and compare SHA-256 metadata without deleting anything.

Update `configure-production.sh` to validate the new local service variables only when `market-live` or `market-retain` profiles are requested. Do not require MCP variables unless `mcp-research` is selected.

- [ ] **Step 4: Document measurable capacity and acceptance gates.**

The capacity template must capture UTC pilot window, symbols, enabled streams, raw event count, NDJSON spool bytes, Parquet bytes, ClickHouse bytes, archive upload lag, replay query p50/p95, collector reconnect count, and observed data-loss count. It must not claim a disk budget before this pilot is filled in.

The README and AGENTS guide must add local-only service startup, profile selection, stop/backup/restore, secret boundary, no-published-data-store-port rule, and all validation commands. The documentation must explicitly state that Docker image build and a 24-hour stream soak require a host with Docker and network access.

- [ ] **Step 5: Run full validation and commit.**

Run: `pnpm test && pnpm check && pnpm lint && bash -n scripts/backup-market-data.sh scripts/restore-market-data.sh scripts/verify-market-archive.sh scripts/configure-production.sh && docker compose -f infra/docker-compose.yml --profile market-live --profile market-retain --profile telegram config >/dev/null`

Expected: PASS; no test uses Binance credentials or calls a private/order endpoint.

```bash
git add scripts README.md AGENTS.md docs/operations tests/market-data/operations-scripts.test.ts
git commit -m "docs: add local market data operations runbook"
```

## Final System Acceptance Checklist

- [ ] `pnpm test`, `pnpm check`, and `pnpm lint` pass with deterministic fixtures.
- [ ] The collector test proves spool-before-cache ordering, reconnection handling, and no direct signal confirmation.
- [ ] Writer tests prove no segment deletion before both ClickHouse and SeaweedFS acknowledgement.
- [ ] Live tests prove every observation is `LIVE_UNCONFIRMED`, uses a separate cooldown, and cannot suppress or create a confirmed signal.
- [ ] Dashboard and Telegram tests prove live controls synchronize through `BotConfigView.liveAlerts` and display the required disclaimer.
- [ ] MCP tests prove disabled-by-default behavior and reject all account, wallet, transfer, or order-like tools before any network request.
- [ ] Compose rendering proves Redis, ClickHouse, SeaweedFS, collector, writer, evaluator, and MCP ports are internal only.
- [ ] A local backup/restore drill verifies manifest checksums and replay of one archived hour.
- [ ] A capacity report records the three-symbol pilot before enabling depth deltas or any additional symbol.

## Plan Self-Review

The plan covers every approved specification requirement. Tasks 1–3 establish public-only contracts, isolated controls, and local infrastructure. Tasks 4–7 implement the at-least-once collector/spool/writer durability path. Tasks 8–10 expose bounded replay and dual dashboard/Telegram live observations without changing the confirmed closed-candle path. Task 11 contains the optional public MCP adapter behind a denylist and disabled default. Task 12 supplies local backup, restore, pilot capacity evidence, and release gates.

The plan contains no automatic vendor-script execution, Binance credentials, private endpoint, order function, managed service, or webhook. Every task has an exact file list, named interfaces, a failing test, expected failure, minimal implementation direction, passing validation command, and commit boundary. The canonical interfaces section defines all types referenced by later tasks; the live control field introduced in Task 2 is the field consumed by Tasks 8–10.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-22-binance-public-realtime-market-data.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh implementation worker per task, review its changes and tests before the next task, and checkpoint after every completed phase.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, in small batches with tests and checkpoints after every phase.

Choose the execution approach only after reviewing this plan and confirming that Phase 0 may begin.
