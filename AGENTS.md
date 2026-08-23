# AGENTS.md — CryptoSignal Engineering Guide

## Mission and non-negotiable boundaries

CryptoSignal is a **signals-only market-research service**. Do not introduce order placement, exchange private keys, portfolio tracking, leverage controls, deposit/withdrawal actions, or imperative personalized trade recommendations. Keep all analytics tied to closed candles, persisted evidence, data quality, and explicit invalidation conditions.

The browser dashboard and Telegram long polling are dual, shared operational surfaces for owner-allowlisted configuration. Keep the browser's research boundary: no order actions, private exchange keys, target prices, or personalized recommendations. Never add Telegram webhooks unless the product owner explicitly changes this architecture.

## Source-of-truth map

| Area | Files |
|---|---|
| Browser UI | `app/(tabs)/index.tsx`, `components/price-history-chart.tsx`, `components/live-market-panel.tsx`, `components/dashboard-auth-screen.tsx` |
| Browser session hook | `hooks/use-dashboard-auth.ts` |
| Password/session server logic | `server/dashboard-auth.ts` |
| Protected research API | `server/routers.ts`, `server/_core/context.ts`, `server/_core/trpc.ts` |
| Database schema and queries | `drizzle/schema.ts`, `server/db.ts` |
| Engine and candle ingestion | `engines/freqtrade/`, `server/signal-ingest.ts` |
| Telegram bot | `server/telegram-polling.ts` |
| Public live-market collector and cache | `server/market-data/binance-collector.ts`, `server/market-data/redis-cache.ts`, `server/market-data/spool.ts` |
| Durable local replay and archive | `server/market-data/event-writer.ts`, `server/market-data/archive.ts`, `server/market-data/replay.ts` |
| Unconfirmed live evaluator and alerts | `server/market-data/live-evaluator.ts`, `server/market-data/live-alerts.ts` |
| Local operations | `scripts/backup-market-data.sh`, `scripts/restore-market-data.sh`, `scripts/verify-market-archive.sh`, `docs/operations/` |
| Documentation | `README.md`, `docs/` |

## Authentication requirements

Use `dashboard_credentials` and `dashboard_sessions` only through `server/dashboard-auth.ts` and `server/db.ts`. Passwords must remain salted PBKDF2-SHA-256 hashes; never log, store, return, or snapshot plaintext passwords, bootstrap keys, or raw session tokens. Browser sessions must remain HTTP-only cookies. Dashboard research routes use `dashboardProtectedProcedure`; do not silently downgrade them to public procedures.

The first admin requires `DASHBOARD_BOOTSTRAP_TOKEN`. The bootstrap path is one-time only. Do not create default admin credentials, hard-code a password, expose the bootstrap token, or add an unauthenticated user-registration endpoint without the owner’s explicit requirement.

## Telegram and runtime rules

Interactive debugging may use the local API and Metro processes, but it must leave Telegram polling and durable market workers disabled. Docker is the only supported full-test and deployment path. In a deployed environment, only the `telegram` profile of `infra/docker-compose.yml` may set `TELEGRAM_POLLING_ENABLED=true`; web and runner services must leave polling disabled. This guarantees exactly one `getUpdates` consumer per bot token. Every bot command must verify `TELEGRAM_ALLOWED_USER_IDS`, persist configuration changes through `updateBotConfig`, and record auditable events.

The Freqtrade runner may retrieve public market data and submit closed-candle snapshots and compact runner health through `SIGNAL_INGEST_TOKEN`. The `runner` Compose profile is the only supported deployed runtime. It uses the project-local uv-managed `engines/freqtrade/.venv`, must not write routine output or overlap runs, and must not use `freqtrade trade`, exchange API keys, or any order capability.

Live-market services are public-data-only. `market-live` runs the Binance public collector, Redis cache, and evaluator; `market-retain` runs ClickHouse, SeaweedFS, and the writer. Redis, ClickHouse, SeaweedFS, collector, writer, evaluator, and optional MCP adapter ports must remain internal to Compose. Raw events never enter MySQL/TiDB; only control-plane records, health, observations, and archive manifests do. Every live observation and alert must retain the exact `LIVE_UNCONFIRMED` boundary and must never create, suppress, or overwrite a confirmed closed-candle signal.

The optional `mcp-research` profile is disabled by default. It may only reach the fixed public MCP endpoint through the denylist-first adapter, an exact public tool allowlist, and an explicit dashboard-confirmed action. Do not enable connectors, add private Binance credentials, or route MCP output into a worker automatically.

## Database changes

For every schema change: update `drizzle/schema.ts`; run `pnpm drizzle-kit generate`; read the generated SQL; verify that it is non-destructive; apply it through the production migration process; and add deterministic tests. Never run destructive SQL or drop data without explicit owner confirmation and a verified backup.

## Required validation

Before a checkpoint, run at least:

```bash
pnpm test:docker
```

When touching secrets, validate them only through a lightweight endpoint or test. Do not print secret values. When touching a database model, verify the generated migration. When touching the browser UI, capture and inspect a responsive browser preview if the development renderer is available.

When touching market operations, run `pnpm test:docker`. A Docker profile render, backup/restore drill, and 24-hour three-symbol public stream soak require a Docker-capable host with network access. Record measured capacity evidence in `docs/operations/market-data-capacity-report-template.md`; never invent a storage budget.

## Documentation and task hygiene

Add every new feature, defect, and operational change to `todo.md` before implementation. Mark it complete only after validation. Keep `README.md` accurate for persistent-host deployment and update the relevant document in `docs/` whenever behavior, commands, authentication, or deployment changes.

## Git authorship

Every repository commit must set both author and committer to `CuongTranXuan <cuongtranxuan.pfiev@gmail.com>`. Before creating a commit in a new workspace, verify `git config user.name` and `git config user.email`; set them to this exact identity if they differ. Do not use an automation-provider, sandbox, or noreply identity.

## Persistent-host deployment checklist

Use HTTPS, a single same-origin reverse proxy for `/api/`, TLS for the database, protected environment files, regular database backups, one Docker-owned polling service, and the Compose runner profile. Docker Python dependencies must be installed only by `uv sync --no-dev --frozen` into the project virtual environment; do not use `pip install --system` or any global Python installation. Do not rely on the development Metro process for production.

For market-retain backups, use timestamped non-destructive archives. `restore-market-data.sh` requires both `--source` and `--target-empty-dir`, refuses a nonempty target, and only stages data for review. Verify archive checksums before any manual import; never delete an archive object or replace a running volume as part of a restore script.
