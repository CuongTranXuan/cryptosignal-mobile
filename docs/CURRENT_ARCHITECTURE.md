# Current Implemented Architecture

## Authority

This document, the root [`README.md`](../README.md), and [`AGENTS.md`](../AGENTS.md) describe the **current implementation**. Earlier mobile-oriented planning documents remain retained as historical research but must not override the actual browser-first architecture.

## Implemented stack

| Layer | Current implementation |
|---|---|
| Client | Static Expo Web bundle, served as a responsive browser dashboard. There is no required native mobile application. |
| Browser authentication | One-time owner bootstrap plus username/password login; PBKDF2-hashed credentials and opaque HTTP-only sessions. |
| API | Node.js Express API with tRPC for protected read models and raw Express routes for auth and engine ingestion. |
| Database | MySQL/TiDB via Drizzle: credentials, hashed sessions, signals, candle history, configuration, Telegram offsets, and audit events. |
| Signal engine | Pinned Freqtrade 2026.7 Python adapter using public Binance spot OHLCV and completed candles only. |
| Bot control | Telegram `getUpdates` long polling in the single Node API process; strict numeric user-ID allowlist. |
| Operations | One Node API process, one scheduled Freqtrade cycle, HTTPS reverse proxy, static `dist-web` bundle, and database backups on a persistent host. |

## Access model

The browser dashboard is **read-only**. It requires an authenticated dashboard session to read signals, charts, status, and scenarios. Telegram is the authoritative write/control surface for watchlists, thresholds, cooldowns, methodology families, alert pause/resume, and current signal requests. No component has access to an exchange private key or an order-placement API.

## Retained historical documents

The following files are useful for methodology and market research, but their mobile-client and proposed-stack language is historical: `mobile_interface_design.md`, `crypto_signal_bot_design.md`, `FRAMEWORK_DECISION.md`, and `IMPLEMENTATION_PLAYBOOK.md`. Future agents must follow the implemented architecture and AGENTS.md unless the product owner explicitly approves a redesign.
