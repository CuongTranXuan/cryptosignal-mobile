# Pinned Runtime Versions

| Component | Version | Purpose |
|---|---:|---|
| Python | 3.12.3 | Command-line validation environment. |
| Freqtrade | 2026.7 | Pinned OHLCV strategy, indicator, backtesting, and dry-run foundation. |
| CCXT | 4.5.74 | Exchange adapter dependency installed by Freqtrade. |
| TA-Lib | 0.7.1 | Indicator and candlestick-pattern primitive installed by Freqtrade. |

The Freqtrade source package is never patched. All product logic is confined to `user_data/strategies/CryptoSignalStrategy.py` and the surrounding control-plane adapters.
