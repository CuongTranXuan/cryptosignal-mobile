# AGENTS.md — CryptoSignal Engineering Guide

## Mission and non-negotiable boundaries

CryptoSignal is a **signals-only market-research service**. Do not introduce order placement, exchange private keys, portfolio tracking, leverage controls, deposit/withdrawal actions, or imperative personalized trade recommendations. Keep all analytics tied to closed candles, persisted evidence, data quality, and explicit invalidation conditions.

The browser dashboard and Telegram long polling are dual, shared operational surfaces for owner-allowlisted configuration. Keep the browser's research boundary: no order actions, private exchange keys, target prices, or personalized recommendations. Never add Telegram webhooks unless the product owner explicitly changes this architecture.

## Source-of-truth map

| Area | Files |
|---|---|
| Browser UI | `app/(tabs)/index.tsx`, `components/price-history-chart.tsx`, `components/dashboard-auth-screen.tsx` |
| Browser session hook | `hooks/use-dashboard-auth.ts` |
| Password/session server logic | `server/dashboard-auth.ts` |
| Protected research API | `server/routers.ts`, `server/_core/context.ts`, `server/_core/trpc.ts` |
| Database schema and queries | `drizzle/schema.ts`, `server/db.ts` |
| Engine and candle ingestion | `engines/freqtrade/`, `server/signal-ingest.ts` |
| Telegram bot | `server/telegram-polling.ts` |
| Documentation | `README.md`, `docs/` |

## Authentication requirements

Use `dashboard_credentials` and `dashboard_sessions` only through `server/dashboard-auth.ts` and `server/db.ts`. Passwords must remain salted PBKDF2-SHA-256 hashes; never log, store, return, or snapshot plaintext passwords, bootstrap keys, or raw session tokens. Browser sessions must remain HTTP-only cookies. Dashboard research routes use `dashboardProtectedProcedure`; do not silently downgrade them to public procedures.

The first admin requires `DASHBOARD_BOOTSTRAP_TOKEN`. The bootstrap path is one-time only. Do not create default admin credentials, hard-code a password, expose the bootstrap token, or add an unauthenticated user-registration endpoint without the owner’s explicit requirement.

## Telegram and runtime rules

Development starts polling in process. In production, only the Docker poller (`infra/docker-compose.poller.yml`) may set `TELEGRAM_POLLING_ENABLED=true`; all other API instances must leave polling disabled. This guarantees exactly one `getUpdates` consumer per bot token. Every bot command must verify `TELEGRAM_ALLOWED_USER_IDS`, persist configuration changes through `updateBotConfig`, and record auditable events.

The Freqtrade runner may retrieve public market data and submit closed-candle snapshots and compact runner health through `SIGNAL_INGEST_TOKEN`. Production scheduling uses `scripts/run-configured-cycle-quiet.sh` and `infra/cron/cryptosignal.crontab`; it must not write routine output or overlap runs. It must not use `freqtrade trade`, exchange API keys, or any order capability.

## Database changes

For every schema change: update `drizzle/schema.ts`; run `pnpm drizzle-kit generate`; read the generated SQL; verify that it is non-destructive; apply it through the production migration process; and add deterministic tests. Never run destructive SQL or drop data without explicit owner confirmation and a verified backup.

## Required validation

Before a checkpoint, run at least:

```bash
pnpm check
pnpm lint
pnpm test
PYTHONPATH=engines/freqtrade pytest -q engines/freqtrade/tests/test_strategy_contract.py
```

When touching secrets, validate them only through a lightweight endpoint or test. Do not print secret values. When touching a database model, verify the generated migration. When touching the browser UI, capture and inspect a responsive browser preview if the development renderer is available.

## Documentation and task hygiene

Add every new feature, defect, and operational change to `todo.md` before implementation. Mark it complete only after validation. Keep `README.md` accurate for persistent-host deployment and update the relevant document in `docs/` whenever behavior, commands, authentication, or deployment changes.

## Persistent-host deployment checklist

Use HTTPS, a single same-origin reverse proxy for `/api/`, TLS for the database, protected environment files, regular database backups, one Docker-owned polling service, and a separate scheduled Freqtrade cycle. Build the static web bundle with `pnpm build:web` and the Node service with `pnpm build`. Do not rely on the development Metro process for production.
