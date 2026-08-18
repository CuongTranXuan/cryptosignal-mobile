# Candle History, Charts, and Conditional Research Outlooks

## Scope

The chart extension records completed public OHLCV candles for **BTC/USDT**, **ETH/USDT**, and **BNB/USDT** on the configured `1h` and `4h` timeframes. Each stored row carries open, high, low, close, volume, EMA 20/50/200, RSI 14, MACD, MACD signal, ATR 14, signal state, signal score, strategy version, and configuration version. The strategy discards the still-forming exchange candle before analysis, preserving closed-candle replay behavior.

| Layer | Implemented behavior | Boundary |
|---|---|---|
| Engine | `run_configured_cycle.py` fetches public candles, calculates the Freqtrade adapter’s indicators, and posts up to 240 normalized history rows per asset/timeframe. | No exchange credentials, account data, or orders are used. |
| Persistence | `candle_history` is idempotent on asset, timeframe, close time, and strategy identity. | Raw history is technical-market data only. |
| API | `market.chart` returns an ordered candle window, matching immutable signal snapshots, and deterministic scenario conditions. | It does not return a target price, entry, position size, or action recommendation. |
| Mobile chart | Candlesticks, EMA overlays, optional RSI pane, timestamp-aligned signal markers, pair/timeframe controls, and touch inspection. | The client renders server-calculated data and does not calculate signals locally. |

## Chart interaction model

The Signals tab has controls for the three supported assets and two timeframes. The chart renders green and red closed candles, EMA 20 and EMA 50 overlays, an optional RSI 14 pane, and colored signal markers aligned to persisted snapshots. Tapping or dragging across the chart selects a historical closed candle and updates its displayed price and timestamp. This is an evidence-inspection interaction rather than a trading workflow.

The retained chart window is ordered by candle close time. Signal markers appear only when a matching snapshot exists in that window, which prevents a current live signal from being visually attached to an earlier candle. The server limits a single client window to 250 rows, while the configured runner currently writes 240 post-warmup rows per pair/timeframe.

## Conditional research outlooks

The application provides three mutually visible conditional narratives: **bullish continuation**, **bearish continuation**, and **range or reversal**. They are deterministic interpretations of the latest closed candle’s EMA relationship, RSI, signal score, ATR, and signal state. Each narrative includes a condition, an invalidation condition, a short research window, evidence strings, and an observed ATR-derived volatility band.

> The observed band is not a forecast, target, probability, or personalized recommendation. It simply visualizes the most recently measured ATR-scale variability around the last close.

The wording avoids imperative language such as “buy,” “sell,” “guaranteed,” or “recommended.” A scenario becomes weaker when its stated invalidation is met on a completed candle. Users must assess market data, risk tolerance, execution costs, and independent sources before acting.

## Operating the history pipeline

Run the configured engine with the API online:

```bash
pnpm dev:api
python3 engines/freqtrade/run_configured_cycle.py --limit 500
```

The runner first writes chart history through `POST /api/signals/candles`, then submits the immutable latest signal through `POST /api/signals/ingest`. Both endpoints require `SIGNAL_INGEST_TOKEN`. Candle rows are idempotently updated if a completed-candle cycle is rerun.

For durable deployment, schedule the configured runner on the persistent host at a cadence no faster than the shortest enabled timeframe. The long-polling Telegram process and API must stay continuously available; no webhook endpoint is required.

## Validation requirements

The extension is accepted only when the schema validates candle inputs, stored history contains all configured asset/timeframe windows, chart queries produce ordered closed candles, scenario text contains invalidation and an explicit research window, and no scenario uses imperative trading language. The current suite covers candle schema bounds, scenario safeguards, backend retrieval, Freqtrade no-trade behavior, and Telegram delivery resilience.

## References

[1] [Binance Spot API — Kline/Candlestick data](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data).  
[2] [Freqtrade strategy customization](https://www.freqtrade.io/en/stable/strategy-customization/).  
