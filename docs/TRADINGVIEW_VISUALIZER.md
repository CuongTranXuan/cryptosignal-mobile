# TradingView Closed-Candle Visualizer

`tradingview/CryptoSignalClosedCandleVisualizer.pine` is a **Pine Script v6 indicator**, not a TradingView strategy. It draws the configured closed-candle score behavior directly on a TradingView chart with EMA overlays, score-transition labels, optional candle tinting, a compact state table, and selectable alert conditions. It contains no `strategy.*` calls, order-routing payloads, exchange credentials, or account integration.

## Install and use

Open a supported TradingView spot chart for `BTCUSDT`, `ETHUSDT`, or `BNBUSDT`, set the chart timeframe to the same one used by CryptoSignal, then open **Pine Editor**, paste the script, save, and add it to the chart. Configure the rule-family inputs and threshold to match the active CryptoSignal configuration. TradingView scripts cannot read the dashboard’s authenticated configuration or persisted signal history, so this manual alignment is intentional.

| Chart element | Meaning |
|---|---|
| `BULL` / `BEAR` label | A newly qualified **closed-candle** setup that crossed the configured positive or negative score threshold. |
| EMA 20 / 50 / 200 | Trend inputs used by the visualized score. |
| Candle tint | A closed bar remains at or beyond the current configured threshold. |
| Status table | The latest closed-candle state, score, and threshold. |
| Data Window plots | Closed-candle score and visual confidence for inspection without changing the price scale. |

The indicator gates every setup marker on `barstate.isconfirmed`. TradingView documents that this state is true for historical bars and on the closing update of a real-time bar, which prevents the open candle from generating a setup marker that later disappears.[1]

## Behavior mapping

The visualizer uses the same weights and threshold classification as the serialized `build_snapshot()` path in `engines/freqtrade/run_signal_cycle.py` for trend, momentum, relative-volume direction, Wyckoff/SMC/Elliott proxy families, and the listed scored candlestick families. It clips the aggregate score to `[-1.0, 1.0]`, marks `BULLISH_SETUP` at `score ≥ threshold`, and marks `BEARISH_SETUP` at `score ≤ -threshold`.

| Family | Visualized weights | Important boundary |
|---|---|---|
| EMA trend | `+/-0.30` | Exact EMA ordering and weight. |
| RSI + MACD | `+/-0.20` | Exact centerline / MACD relationship and weight. |
| Relative volume | `+/-0.10` | Uses a 20-candle average and candle direction, matching snapshot serialization. |
| Engulfing, Harami, Tweezers, Stars, Soldiers/Crows, Inside | `+/-0.10` to `+/-0.15` | Pine reproduces transparent OHLC approximations; it does not call TA-Lib’s proprietary candle-recognition functions. Results can differ from TA-Lib on edge candles. |
| Wyckoff, SMC, Elliott | `+/-0.12` to `+/-0.18` | Explicit experimental proxies, not discretionary analysis or trade instructions. |

> **Parity boundary:** The dashboard/Freqtrade engine remains the source of record for persisted signals and eligibility. TradingView is a local chart visualization only; it does not persist a signal, alter dashboard controls, or deliver an alert through Telegram.

## Alerts

The indicator exposes separate bullish and bearish **new setup** alert conditions. Create the alert in TradingView’s chart interface after selecting the desired inputs. Pine code only declares alert events; it cannot create a running TradingView alert on the user’s behalf.[2] Configure alerts as **Once Per Bar Close** to retain the same closed-candle boundary.

## Validation

The repository contract test verifies the script’s Pine version, closed-candle guard, score weights, setup threshold conditions, alert declarations, and no-execution boundary. Paste the artifact into TradingView’s Pine Editor before relying on it, because TradingView is the authoritative compiler and UI host for Pine scripts.

## References

[1]: https://www.tradingview.com/pine-script-docs/concepts/bar-states/ "TradingView Pine Script — Bar states"
[2]: https://www.tradingview.com/pine-script-docs/concepts/alerts/ "TradingView Pine Script — Alerts"
