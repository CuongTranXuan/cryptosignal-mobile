# CryptoSignal Documentation

CryptoSignal is a **signals-only, public-market research system**. It analyzes completed OHLCV candles and can observe public Binance market streams in real time. It has no exchange private keys, account access, order execution, portfolio controls, or personalized financial advice.

## Current documentation map

| Document | Purpose | Authority |
|---|---|---|
| [`../README.md`](../README.md) | Installation, environment configuration, deployment profiles, backup, restore, and validation commands. | Primary operator guide. |
| [`../AGENTS.md`](../AGENTS.md) | Mandatory coding boundaries, file ownership map, and validation requirements. | Primary agent guide. |
| [`CURRENT_ARCHITECTURE.md`](CURRENT_ARCHITECTURE.md) | Current runtime design, data lifecycle, safety boundaries, and control surfaces. | Primary architecture guide. |
| [`operations/market-data-capacity-report-template.md`](operations/market-data-capacity-report-template.md) | Evidence template for the required three-symbol storage and replay pilot. | Required before capacity decisions. |
| [`research/2026-08-22-binance-superpowers-source-notes.md`](research/2026-08-22-binance-superpowers-source-notes.md) | Historical source notes for the public-data architecture decision. | Reference only. |
| [`superpowers/plans/2026-08-22-binance-public-realtime-market-data.md`](superpowers/plans/2026-08-22-binance-public-realtime-market-data.md) | Completed implementation plan and acceptance rationale. | Historical implementation record. |

The former design proposals, framework comparisons, interface sketches, and overlapping feature backlogs were removed because they described superseded mobile-first or Telegram-authoritative designs. Use the documents above and the codebase as the only current sources of truth.
