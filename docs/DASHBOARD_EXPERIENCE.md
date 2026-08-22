# Dashboard Experience

CryptoSignal’s authenticated dashboard is a **research workspace**, not a single long configuration form. It separates rapid market understanding from operational configuration while keeping the signals-only boundary visible at every decision point.

## Design basis

The interaction model adapts concepts from [FreqUI](https://github.com/freqtrade/frequi): a dashboard should make the current runtime state legible first, give the monitoring view a dedicated surface, and keep detailed settings separate from routine observation. FreqUI is GPL-3.0; CryptoSignal does **not** copy its code, assets, styles, or components. The project retains its own React Native Web implementation and MIT licensing.

> **Adopted principle:** a monitoring screen must state whether its upstream is connected, unavailable, or stale before presenting any market value.

## Workspace structure

| Workspace | Default content | Primary action | Deferred detail |
|---|---|---|---|
| **Research** | Asset/timeframe context, historical chart, latest confirmed signal, conditional outlook | Refresh closed-candle research | Advanced rule configuration |
| **Live monitor** | Public quote, collector-cache status, current unconfirmed observation, service health | Refresh a credential-free public quote | Collector deployment guidance |
| **Controls** | Pause/resume, selected markets and timeframes, confirmed and live alert enablement | Save a small, explicit configuration change | Pattern and methodology controls grouped as advanced research settings |

The header stays compact: product identity, the selected workspace, a short runtime state, language choice, and sign-out. Telegram remains optional and is not presented as a prerequisite for using the dashboard.

## Live-data behavior

The live monitor distinguishes two public paths rather than silently treating cache failure as data absence. The preferred path is the self-hosted Redis cache fed by the public WebSocket collector. When that worker is not deployed, the dashboard offers an explicit, on-demand public quote request to Binance’s documented market-data-only REST endpoint. This request uses no API key, stores no raw event, does not imply that the durable collector is running, and is clearly labelled **PUBLIC QUOTE — ON DEMAND**.

If neither source can respond, the interface reports the unavailable collector state and keeps the on-demand refresh action visible; a failed quote request reports its service error rather than presenting a fabricated price. `LIVE_UNCONFIRMED` observations remain visually distinct from confirmed closed-candle signals.

## Acceptance criteria

The redesigned dashboard must load with one visible primary action per workspace; a user can refresh a current public quote without Redis or exchange credentials; live cache health cannot be mistaken for an active quote; configuration changes have explicit pending and saved feedback; and detailed rule controls do not dominate the initial research view.

## References

1. [FreqUI repository](https://github.com/freqtrade/frequi)
2. [Freqtrade FreqUI documentation](https://www.freqtrade.io/en/stable/freq-ui/)
3. [Binance market-data-only URLs](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
