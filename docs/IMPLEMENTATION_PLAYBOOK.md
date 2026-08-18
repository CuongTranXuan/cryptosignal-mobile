# Agent-Ready Implementation Playbook

**Status:** Ready for a coding agent to implement in phases  
**Primary decision:** Use the framework boundary defined in `FRAMEWORK_DECISION.md`  
**Initial delivery:** Signals-only; Telegram controls; public OHLCV; no orders or private exchange keys

## 1. Repository topology

The current Expo project is the mobile companion. Create the following repository layout without modifying Freqtrade upstream source. A monorepo is preferred because contracts, docs, test fixtures, and deployment manifests evolve together.

```text
cryptosignal/
├── apps/
│   └── mobile/                         # Existing Expo project
├── services/
│   ├── control-plane/                  # Python 3.11+, FastAPI, Pydantic, SQLAlchemy/Alembic
│   │   ├── app/
│   │   │   ├── api/                    # Authenticated mobile and internal endpoints
│   │   │   ├── domain/                 # Config, signal, audit, evaluation entities
│   │   │   ├── services/               # Orchestration, persistence, alert policy
│   │   │   ├── adapters/               # Freqtrade runner and storage adapters
│   │   │   └── workers/                # Durable analysis/backtest jobs
│   │   └── tests/
│   └── telegram-gateway/               # Python 3.11+, aiogram, webhook mode
│       ├── app/commands/
│       ├── app/keyboards/
│       ├── app/presenters/
│       └── tests/
├── engines/
│   └── freqtrade/
│       ├── Dockerfile                  # Extends an official, pinned Freqtrade image
│       ├── config/
│       │   └── signals-only.template.json
│       └── user_data/
│           ├── strategies/CryptoSignalStrategy.py
│           ├── signal_rules/
│           └── tests/
├── packages/
│   ├── signal-contracts/               # Versioned JSON Schema and generated Python/TS models
│   └── test-fixtures/                  # Frozen OHLCV and expected findings
├── infra/
│   ├── compose/                        # Local Docker Compose only
│   ├── migrations/
│   └── deployment/                     # Container and secret references; no literal secrets
└── docs/                               # This package
```

The Freqtrade engine requires a Docker-capable persistent runtime. The existing managed Expo/Node environment is appropriate for the mobile app but not for a Python/Docker engine worker. A development agent must deploy the engine to a separate, persistent Docker host under the selected organization’s infrastructure policy. The mobile app remains deployable independently.

## 2. Version and dependency policy

Pin Python at 3.11 or a version supported by the chosen Freqtrade release. Pin Freqtrade to an explicit stable tag and record it in `engines/freqtrade/VERSIONS.md`. Pin FastAPI, aiogram, Pydantic, SQLAlchemy, Alembic, PostgreSQL, Redis or a chosen job queue, and the Telegram Bot API client version. The agent must produce locked dependencies, a software bill of materials, a license report, and an upgrade test procedure.

Use Freqtrade through its documented strategy and configuration interfaces. Freqtrade’s strategy documentation describes OHLCV data frames, vectorized indicators, completed candles, startup-candle requirements, and backtesting/dry-run modes [1]. Do not call private Freqtrade internals or copy library code into the custom strategy.

## 3. Core contracts

The `packages/signal-contracts` package is the only cross-service language. Publish JSON Schema first, then generate or hand-maintain equivalent Pydantic and TypeScript types. Every payload includes `schema_version`, `event_id`, `observed_at`, and `correlation_id`.

### Signal snapshot

```json
{
  "schema_version": "1.0",
  "signal_id": "sig_01J...",
  "asset": {"venue": "binance_spot", "symbol": "BTC/USDT"},
  "timeframe": "4h",
  "candle": {"open_time": "2026-08-18T04:00:00Z", "close_time": "2026-08-18T08:00:00Z", "is_closed": true},
  "state": "BULLISH_SETUP",
  "score": 0.62,
  "confidence": 0.74,
  "regime": "TREND_UP",
  "findings": [],
  "conflicts": [],
  "invalidation": {},
  "data_quality": {"state": "PASS", "checks": []},
  "strategy_version": "0.1.0",
  "config_version": 12,
  "source_manifest_id": "manifest_01J..."
}
```

### Finding

```json
{
  "finding_id": "find_01J...",
  "rule_family": "CANDLE_PATTERN",
  "rule_id": "BULLISH_ENGULFING_V1",
  "direction": "BULLISH",
  "strength": 0.35,
  "evidence": {"body_ratio": 0.72, "prior_trend": "DOWN", "support_distance_atr": 0.18},
  "invalidation": {"type": "CLOSE_BELOW", "price": "61800.00"},
  "detector_version": "1.0.0"
}
```

### Configuration version

Every Telegram mutation creates a new configuration version. Required fields are user ID, authorized chat ID, symbol/timeframe watchlist, enabled rule families, scoring profile, alert threshold, cooldown, quiet hours, and creation metadata. The engine consumes a read-only materialized configuration. It never interprets free-form Telegram text directly.

## 4. Telegram command contract

The gateway implements the command surface from `crypto_signal_bot_design.md`. Commands are parsed into typed requests, validated, persisted, and presented back as a configuration diff before final confirmation. The minimal first increment is `/start`, `/status`, `/watchlist`, `/signal`, `/why`, `/pause`, `/resume`, and `/help`.

Telegram receives updates through a verified HTTPS webhook. Telegram documents webhook secret tokens and `update_id` sequencing, both of which must be enforced for authenticity and idempotency [2]. The gateway must allow only approved Telegram user IDs; group use is disabled by default. Freqtrade itself also documents an authorized-user mechanism for Telegram controls [3], but the product gateway is the authoritative authorization layer.

## 5. Freqtrade implementation boundary

`CryptoSignalStrategy` must subclass the supported Freqtrade strategy interface and use vectorized `populate_indicators()` behavior. It owns only feature computation and finding emission. It must never create real orders. Its output is a versioned signal payload emitted through a local authenticated control-plane callback or a durable job sink.

The initial engine profile must reject execution by static configuration and tests:

| Guard | Required setting or assertion |
|---|---|
| Private exchange keys | Schema prohibits key/secret/password fields. |
| Live trade mode | Deployment rejects live mode and live exchange credential mounts. |
| Directional trade instructions | Strategy fixture asserts all `enter_*` and `exit_*` columns remain zero/absent in signals-only mode. |
| Force-entry controls | Deployment schema rejects `force_entry_enable`. |
| Futures/shorting | `can_short = false`; engine accepts spot public OHLCV only. |
| Callback side effects | Strategy cannot send Telegram messages or write databases directly. |
| Alert persistence | Control plane persists `SignalSnapshot` before gateway delivery. |

Freqtrade exposes strategy-level custom messaging and webhook delivery mechanisms [4]; CryptoSignal uses a control-plane callback instead so rich evidence, retries, authorization, and audit policy remain product-owned and testable.

## 6. Milestone plan

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0 — Repository and contracts | New topology, pinned dependencies, JSON schemas, Compose development environment, secrets templates. | CI validates schemas and no secrets are committed. |
| M1 — Data and health | Binance spot OHLCV adapter, UTC normalizer, gap/duplicate/staleness checks, `GET /health` and `GET /assets`. | Frozen-candle replay matches exact expected rows; stale feed is observable. |
| M2 — Telegram control | aiogram webhook, allowlist, command parser, config versioning, `/status`, `/watchlist`, `/help`. | Duplicate update test, unauthorized-user test, config rollback test. |
| M3 — Core findings | EMA/SMA, RSI, MACD, ADX, ATR, volume features, all requested candlestick patterns, evidence ledger. | Positive/negative/boundary fixtures for every detector. |
| M4 — Framework integration | Freqtrade strategy wrapper, closed-candle signal pipeline, immutable `SignalSnapshot`, alert cooldown. | Look-ahead analysis passes; no-trade assertion passes; replay is deterministic. |
| M5 — Methodology rules | Wyckoff range-state machine, narrow SMC proxies, optional Elliott candidate labels. | Each rule exposes evidence/invalidation and supports neutral/conflicted output. |
| M6 — Evaluation and paper mode | Backtest jobs, walk-forward, ablation, paper outcomes, report artifact. | Information cutoff/censor-gap tests pass; reports include data manifest and assumptions. |
| M7 — Mobile companion | Overview, Signals, Configuration Mirror, Health, Telegram deep links. | No placeholder market numbers; API error/stale/empty states pass. |
| M8 — Hardening | Alerts, audit, observability, rate limits, backups, operator runbook, beta. | Load, security, disconnect, duplicate, and recovery drills pass. |

## 7. Required test suites

The following suites are mandatory and should run in CI. A test without frozen input data is insufficient for quantitative logic.

| Suite | Minimum tests |
|---|---|
| Contract suite | JSON Schema compatibility, Pydantic/TypeScript parity, backward-reading old snapshots. |
| OHLCV suite | UTC conversion, gap detection, duplicate deduplication, out-of-order handling, closed-candle invariant. |
| Pattern suite | Positive, negative, tolerance-boundary, missing-history, and context-invalid fixtures for each pattern. |
| Strategy suite | No future candle read, no direct network/DB/Telegram calls, no trade columns in signals-only profile. |
| Replay suite | Same candle manifest + config + strategy version produces byte-equivalent `SignalSnapshot`. |
| Freqtrade suite | Framework look-ahead and recursive analysis; smoke backtest with pinned release. |
| Telegram suite | Webhook secret verification, idempotent update handling, authorization, command parsing, confirmation flow. |
| Evaluation suite | Censor gap, chronological splits, fee/slippage assumptions, and no random temporal shuffle. |
| Mobile suite | API loading/error/stale/empty states, deep links, accessibility labels, no local signal calculation. |

## 8. Definition of done

A milestone is complete only when its code, tests, contracts, migrations, structured logs, metrics, documentation, and rollback behavior have been reviewed. A production-candidate signal system is complete only when it can replay BTC/USDT, ETH/USDT, and BNB/USDT closed candles; persist identical signal snapshots on replay; explain evidence and conflicts; block unauthorized Telegram users; reject any exchange credential; and surface feed freshness in both Telegram and the mobile app.

## 9. Coding-agent guardrails

Do not replace Freqtrade with a custom data loop. Do not fork or patch Freqtrade. Do not expose the Telegram bot token to the mobile client. Do not use an LLM to calculate numerical indicators or decide a signal state. Do not backfill missing data with fabricated candles. Do not emit an alert before snapshot persistence. Do not call an order-placement endpoint, even in an integration test. Do not report simulated outcomes without explicit horizon, assumptions, and data manifest.

## References

[1]: https://www.freqtrade.io/en/stable/strategy-customization/ "Freqtrade strategy customization"

[2]: https://core.telegram.org/bots/api "Telegram Bot API — updates and webhooks"

[3]: https://www.freqtrade.io/en/stable/telegram-usage/ "Freqtrade Telegram usage"

[4]: https://www.freqtrade.io/en/stable/webhook-config/ "Freqtrade webhook and strategy message configuration"
