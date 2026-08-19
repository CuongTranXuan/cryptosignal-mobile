# Dual Control, 30-Minute Analysis, and Interactive Chart Update

This supplement records the browser-dashboard expansion that follows the earlier Telegram-first operating model. It does not change the system's safety boundary: CryptoSignal evaluates **closed public OHLCV candles only**, is **signals-only**, never places orders, and never stores exchange private keys.

## One Shared Configuration Record

Telegram and the dashboard now mutate the same versioned configuration record. The signal runner retrieves that record from `GET /api/signals/config` before every configured cycle, so operational changes take effect on the next closed-candle analysis cycle regardless of where they were made.

| Setting | Dashboard control | Telegram command |
| --- | --- | --- |
| Processing state | Pause or resume button | `/pause`, `/resume` |
| Watchlist | BTC/USDT, ETH/USDT, BNB/USDT selectors | `/watchlist add|remove SYMBOL` |
| Timeframes | 30m, 1h, 4h selectors | `/timeframes add|remove 30m|1h|4h` |
| Alert threshold | 0–100% evidence rail | `/threshold 0.55` |
| Alert cooldown | 1–1440 minute entry | `/cooldown 60m` |
| Rule families | Explainable methodology toggles | `/methodology enable|disable FAMILY` |

The dashboard displays the configuration version and the most recent control surface, either `TELEGRAM`, `DASHBOARD`, or `SYSTEM`. Each persisted change is audit logged with its actor type. No setting modifies a trading account because the system has no execution capability.

## 30-Minute Closed-Candle Support

The supported timeframe set is `30m`, `1h`, and `4h`. Binance public klines support `30m`; the engine removes unfinished candles before computing EMA, RSI, MACD, pattern, and methodology evidence. The runner requires at least 211 completed candles because the strategy includes EMA200 context.

```bash
python3 engines/freqtrade/run_signal_cycle.py \
  --symbol BTC/USDT --timeframe 30m --limit 240
```

The configured multi-market runner already loops over the configuration mirror, so no separate scheduler path is necessary for the new timeframe. Its default history window remains large enough for the long-period indicators.

## Browser Charting Framework

The dashboard chart uses **TradingView Lightweight Charts 5.2.0**, a maintained Apache-2.0 library, instead of the previous custom SVG renderer. The library's visible TradingView attribution remains enabled as required by its license.

| Chart capability | Implementation |
| --- | --- |
| Price evidence | OHLC candlestick series on a UTC-second time scale |
| Overlay indicators | EMA20 and EMA50 lines |
| Oscillator panes | Separate RSI14 and MACD/signal/histogram panes |
| Historical evidence | Bullish, bearish, and neutral signal markers attached to persisted candle times |
| Inspection | Crosshair tooltip values for OHLC, RSI, and MACD |
| Navigation | Mouse-wheel/pinch zoom, drag-to-pan, and double-click scale reset |
| Research aids | Optional local horizontal close-price levels; these are not persisted or alerts |

Chart markers, scenario outlooks, and indicator layers are explanatory research evidence. They are not personalized recommendations, forecast guarantees, order triggers, or target prices.

## Validation

The following validation gates cover the shared configuration surface, 30-minute window contract, Telegram command parsing, strategy contract, and the maintained chart integration.

```bash
pnpm check
pnpm lint
pnpm test
PYTHONPATH=engines/freqtrade pytest -q engines/freqtrade/tests/test_strategy_contract.py
freqtrade show-config --config engines/freqtrade/config/signals-only.json --userdir engines/freqtrade/user_data
```
