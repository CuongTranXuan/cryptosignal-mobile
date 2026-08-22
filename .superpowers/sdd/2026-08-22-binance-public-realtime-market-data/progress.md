# SDD ledger — plan: docs/superpowers/plans/2026-08-22-binance-public-realtime-market-data.md

**Workspace:** `/home/ubuntu/cryptosignal-mobile/.worktrees/binance-live-market`

**Merge base:** `94447e3` (`chore: prepare isolated live market workspace`)

## Preflight interface and task-coherence scan

| Tasks / scope | Producer and consumer relationship | Finding / ruling |
|---|---|---|
| Task 1 | Produces canonical public event, observation, health, stream, and condition contracts consumed by Tasks 2, 4, 5, and 9. | Coherent. No live connection, private scope, or runtime worker is introduced. |
| Task 2 | Extends `BotConfigView` using Task 1 condition IDs and adds MySQL/TiDB control-plane records consumed by Tasks 6–11. | Coherent. The separate `liveAlerts` field prevents coupling to confirmed cooldown and threshold fields. |
| Task 3 | Produces internal Compose profiles and ClickHouse/SeaweedFS services consumed by Tasks 6, 7, and 12. | Coherent except the aggregate-table engine noted below. |
| Task 4 | Produces a local at-least-once spool consumed by collector and writer tasks. | Coherent. State must retain segments until both acknowledgements exist. |
| Task 5 | Produces normalized events and Redis snapshots consumed by Task 6 collector and Task 9 evaluator. | Coherent. Canonical raw payload values remain lossless strings. |
| Task 6 | Consumes Tasks 2, 4, and 5 to create the public collector. | Coherent. Spool-before-cache and closed-kline-only notification preserve the confirmation boundary. |
| Task 7 | Consumes Tasks 2–4 to persist to ClickHouse and SeaweedFS. | Coherent. Manifests remain in MySQL/TiDB while raw events stay outside it. |
| Task 8 | Consumes Task 2 health and Task 7 warm data to expose bounded replay. | Coherent. Redis reads cannot fall back to Binance. |
| Task 9 | Consumes Task 2 live control config and Task 5 cache snapshot to emit `LIVE_UNCONFIRMED` observations. | Coherent. It does not call `recordSignalSnapshot` or confirmed alert cooldown helpers. |
| Task 10 | Consumes Tasks 8–9 routes and formats dual dashboard/Telegram control surfaces. | Coherent. UI must keep live observations separate from `SignalCard`. |
| Task 11 | Consumes Task 2 audit/health helpers for optional disabled-by-default MCP research. | Coherent. The denylist acts before network transport. |
| Task 12 | Consumes Tasks 3 and 7 archive services and manifests for local backup/restore. | Coherent. Operations scripts are non-destructive by default. |
| Tasks 1 → 2 → 5 → 6 → 9 | Shared type/config/cache sequence. | Coherent dependency order; implementations must not import later worker code into shared contracts. |
| Tasks 3 → 6/7 → 12 | Shared Compose, persistent volumes, and archive lifecycle. | Coherent dependency order; no additional published service ports are permitted. |
| Tasks 2 → 8/9/10/11 | Shared control-plane, audit, health, and dashboard semantics. | Coherent dependency order; all new config updates must retain dashboard/Telegram attribution. |

## Rulings

- **Ruling: Task 3’s `market_bars_1m` must use `AggregatingMergeTree` with aggregate-state columns instead of `SummingMergeTree`.** The plan’s draft materialized view calculated `min`, `max`, `argMin`, and `argMax` while specifying `SummingMergeTree`; summing OHLC values corrupts bar results after merges. The implementation will use `minState`, `maxState`, `argMinState`, `argMaxState`, and `countState`, then query corresponding `…Merge` functions. This preserves the approved local ClickHouse architecture and correct replay semantics. **Cost if wrong:** the first ClickHouse deployment needs a migration rather than a clean bootstrap.
- **Ruling: Task 2’s TiDB migration must add `liveAlertsJson` as nullable, backfill the disabled policy, then enforce `NOT NULL`.** TiDB rejected a text-column default during the first reviewed attempt. The corrected migration preserves existing rows without destructive DDL. The already-applied migration hash was recorded in Drizzle’s ledger so future deploys do not apply the DDL twice. **Cost if wrong:** fresh host setup fails or existing bot configuration becomes unavailable.

## Task status

- Task 1: fix round 1/5 (fixture regression coverage addressed; commits `1f819a1..f6f095f`)
- Task 1: complete (commits `94447e3..f6f095f`, review clean)
- Task 2: fix round 1/5 (invalid and empty enabled live policies fail closed; commits `65d4386..d7805cc`)
- Task 2: complete (focused persistence tests, Drizzle generation/migration, TypeScript, and whitespace checks pass; confirmed and live cooldown helpers query distinct audit actions)
- Task 3: fix round 1/5 (added aggregate-state function regression coverage after independent review; commits `1a9a5f3..4edc901`)
- Task 3: complete (Compose contracts, full test suite, TypeScript, lint, and whitespace checks pass; Docker Compose rendering remains an external acceptance gate because Docker is unavailable in this sandbox)
- Task 4: fix round 1/5 (preserved valid final NDJSON records without a trailing newline; commits `cb34539..3505212`)
- Task 4: complete (focused spool recovery tests, full test suite, TypeScript, lint, and whitespace checks pass; segments remain until both ClickHouse and archive acknowledgements exist)
- Task 5: fix round 1/5 (freshness chooses the latest parsed instant rather than timestamp string order; commits `fcf16c2..123f83a`)
- Task 5: complete (focused normalization/cache tests and serial full regression suite pass; Redis failures remain typed and the cache is not a prerequisite for spooling)
- Task 6: fix round 1/5 (collector rejects normalized kline events outside its configured timeframe subscription; commits `9b00c6f..d2b4bd4`)
- Task 6: complete (collector lifecycle tests, serial full regression suite, TypeScript, lint, and production server bundle checks pass; Docker Compose execution remains an external acceptance gate because Docker is unavailable in this sandbox)
- Task 7: fix round 1/5 (independent review hardened canonical archive digests, collision-resistant ClickHouse batch identifiers, full archive-set acknowledgements, and SeaweedFS bucket readiness before event processing)
- Task 7: complete (Parquet serialization, local S3 upload and HeadObject verification, ClickHouse persistence, replay-safe spool acknowledgements, worker profile, focused tests, serial full regression suite, TypeScript, lint, and production server bundle checks pass; Docker Compose execution remains an external acceptance gate because Docker is unavailable in this sandbox)
