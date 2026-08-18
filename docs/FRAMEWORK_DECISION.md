# Framework Decision — Build on Freqtrade, Do Not Build a Trading Engine from Scratch

**Decision status:** Approved for implementation planning  
**Scope:** Signals-only crypto OHLCV analytics, Telegram-first control, mobile companion  
**Recommended stack:** **Freqtrade (Python engine) + FastAPI (control-plane API) + aiogram (Telegram gateway) + PostgreSQL + Expo/TypeScript mobile companion**

> This architecture is a research and monitoring system. It does not authorize order execution, exchange private keys, account access, or personalized investment advice.

## Decision

Use **Freqtrade as the market-data, indicator, strategy-replay, backtesting, and dry/paper-analysis foundation**. Keep Freqtrade unmodified and pinned to a reviewed stable release. Build the Telegram configuration/control experience and the application-specific evidence ledger **outside Freqtrade** in a small, conventional Python control plane using FastAPI and aiogram. The existing Expo mobile project remains a read-only companion to that control plane.

This avoids a bespoke trading framework while preserving a clean product boundary. Freqtrade already provides OHLCV handling, strategy interfaces, backtesting, plotting, dry-run capabilities, look-ahead analysis, exchange abstractions, and Telegram support [1]. Its strategy API accepts vectorized indicator computation over OHLCV data and makes only completed candles available to the strategy data frame, which reinforces the product's closed-candle rule [2]. The framework supports strategy-originated messages through `self.dp.send_msg()` and can restrict Telegram control to authorized users [3].

## Why this is the best initial foundation

The product’s first release is an explainable signal monitor, not a latency-sensitive execution system. Freqtrade is directly aligned with that job because its core abstractions are OHLCV strategy data, indicators, backtesting, dry run, strategy configuration, and Telegram-aware operation. Building these layers from first principles would create unnecessary long-term maintenance: exchange symbol mappings, candle freshness, data downloads, historical replay, indicator handling, backtesting discipline, and strategy compatibility would all become custom responsibilities.

The product requires richer, user-configurable Telegram commands than Freqtrade’s predefined command list. That is why the solution is **not** a Freqtrade fork. The custom Telegram gateway owns commands such as `/watchlist`, `/profile`, `/methodology`, `/threshold`, `/why`, and `/backtest`. It writes validated configuration versions to the control plane, which creates read-only Freqtrade runtime configuration and invokes supported Freqtrade interfaces. Freqtrade’s native Telegram facility is optional and may be kept disabled in production, except for an isolated developer/testing configuration.

## Alternatives considered

| Framework | Strengths | Why it is not the primary choice now | Future trigger to reconsider |
|---|---|---|---|
| **Freqtrade — selected** | Mature Python crypto framework with OHLCV strategy interface, backtesting, dry run, optimization, exchange adapters, Telegram controls, and look-ahead/recursive analysis tooling [1] [2]. | Its native Telegram command set is not a full product-control API, so it must be paired with a separate gateway. It is execution-oriented, requiring strict no-trade safeguards. | Continue unless multi-venue event-level data or latency requirements exceed candle-driven analysis. |
| NautilusTrader | Rust-native event engine with Python control plane, deterministic backtesting, modular adapters, and research-to-live semantics [4]. | Excellent but heavier than needed for candle-closed signals. It adds a more specialized event-driven model and does not supply the Telegram-product control layer. | Adopt for a later high-fidelity, multi-venue, tick/order-book, or Rust-critical research platform. |
| Hummingbot | Broad centralized/decentralized exchange connectors, reusable strategy controllers, paper trading, and execution-oriented components [5]. | Strong execution framework, but the product is deliberately signals-only. Its connector and strategy model would introduce more execution surface area than necessary. | Re-evaluate only if the product explicitly evolves into market making, cross-venue routing, or DEX execution. |
| Jesse | Research-friendly Python strategy framework with multi-timeframe workflows, visual backtests, Monte Carlo analysis, alert integrations, and ML tooling [6]. | Useful reference and research tool, but Freqtrade more directly covers the initial requirements for exchange OHLCV ingestion and Telegram-managed operation. | Consider as a parallel research lab, not as the first production signal runtime. |
| Vanilla Python/Node/Go/Rust | Full design freedom. | Recreates mature framework features and makes every coding agent responsible for the engine lifecycle. It fails the maintainability objective. | Never for the engine; use small custom modules only around stable framework interfaces. |

## Boundary: what belongs where

| Layer | Owns | Must not own |
|---|---|---|
| Freqtrade engine | Public OHLCV acquisition, completed-candle handling, indicators, candle-pattern primitives, strategy replay, backtesting, look-ahead/recursive analysis, dry/paper analysis. | Telegram product commands, user configuration persistence, account secrets, mobile API, or order execution. |
| Signal adapter package | Versioned finding schemas, candle-pattern context checks, Wyckoff/SMC proxy rules, Elliott experimental labels, scoring, evidence ledger serialization. | Direct database writes or Telegram API calls. |
| FastAPI control plane | Configuration versions, run requests, signal persistence, audit log, idempotency, status APIs, Freqtrade job orchestration. | Indicator calculation duplicated from the engine. |
| aiogram Telegram gateway | Commands, inline menus, authorization, input validation, user-facing messages, notification delivery. | Direct exchange API calls or mutable engine internals. |
| Expo mobile companion | Read-only status, signal history, config mirror, deep links to Telegram. | Strategy computation, secret storage, control-plane business rules. |

## Signals-only safety configuration

The engine configuration must make execution impossible by design, not just by operator intention. The initial implementation uses public-market data only, contains no exchange API key fields, keeps `can_short = false`, returns no `enter_long`, `enter_short`, `exit_long`, or `exit_short` trade instructions, and sets the engine strategy to emit structured findings through the control-plane adapter rather than through trade lifecycle callbacks. The system must reject any configuration containing private exchange credentials, nonzero order stakes, or force-entry capabilities.

Freqtrade identifies signals at candle close and explicitly distinguishes a signal from an executed trade [2]. CryptoSignal uses the signal portion only. The control plane must store a `SignalSnapshot` before it dispatches a Telegram message. A future execution initiative cannot be enabled by a configuration flag; it requires a separate deployment profile and governance approval.

## Maintainability policy

The project must never patch Freqtrade source code. The lock file must pin the exact Freqtrade release, and each upgrade must run the framework compatibility suite, strategy replay suite, no-look-ahead analysis, and a backtest comparison against a frozen candle manifest. Custom code lives only in `services/control-plane`, `services/telegram-gateway`, `engines/freqtrade/user_data`, and `packages/signal-contracts`. All cross-boundary payloads are versioned JSON contracts.

## References

[1]: https://github.com/freqtrade/freqtrade "Freqtrade — official repository and feature overview"

[2]: https://www.freqtrade.io/en/stable/strategy-customization/ "Freqtrade — strategy customization, OHLCV data, completed-candle behavior, and dry-run guidance"

[3]: https://www.freqtrade.io/en/stable/telegram-usage/ "Freqtrade — Telegram controls, authorized users, and strategy messages"

[4]: https://nautilustrader.io/docs/latest/concepts/overview/ "NautilusTrader — Rust-native event-driven research, simulation, and live architecture"

[5]: https://github.com/hummingbot/hummingbot "Hummingbot — open-source exchange and execution framework"

[6]: https://github.com/jesse-ai/jesse "Jesse — open-source crypto strategy research and trading framework"
