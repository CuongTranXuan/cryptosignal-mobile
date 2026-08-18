# CryptoSignal Documentation Package

This project is intentionally **documentation-first**. The Expo project is only a future mobile companion scaffold; it contains no market-data ingestion, Telegram commands, indicator calculations, trade execution, exchange credentials, or automated trading.

| File | Purpose |
|---|---|
| `crypto_signal_bot_design.md` | Complete product specification, technical design, Telegram command model, data model, evaluation protocol, security model, and implementation roadmap. |
| `crypto_signal_bot_research_notes.md` | Verified commercial-product, open-source, methodology, and integration research notes. |
| `crypto_signal_bot_architecture.mmd` | Editable Mermaid source for the system architecture. |
| `crypto_signal_bot_architecture.png` | Rendered system architecture diagram. |

The design assumes a **signals-only** first release. Any future decision to add exchange execution must be reviewed as a separate scope change and must not reuse this scaffold without a dedicated security, regulatory, and risk-control design review.
