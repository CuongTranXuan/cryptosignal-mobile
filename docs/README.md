# CryptoSignal Documentation Package

This documentation set is the **implementation source of truth** for CryptoSignal. The product is a Telegram-controlled, signals-only OHLCV analysis system with a mobile companion. It does not place orders, store exchange private keys, or manage funds.

## Reading order

| Order | File | Review purpose |
|---:|---|---|
| 1 | `FRAMEWORK_DECISION.md` | The maintainable foundation: **Freqtrade + FastAPI + aiogram**, with a strict no-fork boundary. |
| 2 | `crypto_signal_bot_design.md` | Product scope, rule families, Telegram UX, architecture, evaluation, and security requirements. |
| 3 | `IMPLEMENTATION_PLAYBOOK.md` | Agent-ready repository layout, interfaces, milestones, test gates, deployment boundary, and acceptance criteria. |
| 4 | `framework_architecture.png` and `framework_architecture.mmd` | Revised component boundary diagram. The Mermaid file is the editable source. |
| 5 | `crypto_signal_bot_research_notes.md` | Verified commercial, open-source, methodology, and integration research. |
| 6 | `mobile_interface_design.md` | Portrait mobile companion screen and interaction plan. |
| 7 | `implementation_backlog.md` | Current completed and planned work register. |
| 8 | `crypto_signal_bot_architecture.png` and `crypto_signal_bot_architecture.mmd` | Original product architecture diagram and editable source. |
| 9 | `LOCAL_OPERATION.md` | Current command-line validation steps, environment requirements, and durable-host boundary. |
| 10 | `CHARTING_AND_SCENARIOS.md` | Candle-history model, mobile chart behavior, conditional research-outlook contract, and operations. |

## Non-negotiable implementation rules

The coding team must pin framework and dependency versions, integrate Freqtrade as an unmodified upstream dependency, and keep all custom logic in the defined adapter, strategy, control-plane, and Telegram gateway modules. A signal must originate from **closed candles only**, contain a reproducible evidence ledger, and be persisted before any Telegram delivery attempt. The Telegram gateway is the authoritative control interface; the mobile client only mirrors read-only state and deep-links users back to Telegram.

Any proposal for exchange execution, balance retrieval, leverage, or private keys is a separate product change. It requires an explicit security, risk, legal, and user-consent design review before implementation.
