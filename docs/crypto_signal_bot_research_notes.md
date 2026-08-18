# Research Notes — Commercial Market

As-of date: 2026-08-18 (user timezone context).

## Coinrule
Source: https://coinrule.com/

Verified from the product page: Coinrule positions itself as a no-code automated trading-bot platform. It describes condition/indicator/time-based logic, backtesting, templates, 350+ trading bots, automation across 20+ exchanges/brokers/blockchains, and an MCP surface for AI-assisted strategy creation and management. The page explicitly lists Binance, Coinbase, Kraken, KuCoin, OKX, Bybit, Bitget, Hyperliquid, and several stock brokers. This establishes the commercial baseline for configurable rule builders, backtesting, multi-venue connectivity, and automation beyond signal-only delivery.

## Cryptohopper
Source: https://www.cryptohopper.com/

Verified from the product page: Cryptohopper describes itself as a highly customizable crypto trading bot with exchange account management, trailing features, trading bots, DCA, market-making, arbitrage, copy trading, a strategy marketplace, templates, triggers, and technical-analysis strategies. Its page also describes signals from third-party analysts and a multi-exchange model. The page's structured metadata reports plan-specific technical-analysis intervals ranging from 10 minutes to 2 minutes and plan-specific limits on selected coins, triggers, and positions; treat those plan figures as vendor-published metadata and re-verify before implementation.

## GoodCryptoX
Source: https://goodcrypto.app/good-crypto-signals-the-best-crypto-trading-signals-based-on-technical-indicators/

Verified from the product page: GoodCryptoX markets live technical-analysis signals across 30+ CEXs and Hyperliquid. It describes a composite summary of 15 moving averages and 10 oscillators, with time aggregation such as 5-minute periods for day view, 30-minute periods for week view, 6-hour periods for month view, and 1-day periods for year/2-year views. It exposes buy/sell/strong buy/strong sell states and combines signal viewing with bot/trading workflows. The page also states the signals are for further research and not financial advice.

## SYGNAL
Source: https://sygnal.ai/

Verified from the product page: SYGNAL offers model-driven crypto signals and strategies with daily or hourly frequency depending on product, including trend-following, mean-reversion, momentum, market-neutral, sentiment, and hybrid approaches. It describes a standardized signal scale from -1.00 to +1.00, model/strategy metadata, partner distribution through bot platforms, and a blockchain-anchored hash record for tamper-evident signal provenance. The page includes risk and informational-use disclosures.

## Initial product implications

1. Commercial products emphasize broad exchange coverage, automation, strategy templates, multi-indicator composites, marketplace/social features, and increasingly AI/quant packaging.
2. A differentiated signal-only product should prioritize explainability, Telegram-native control, reproducible signal snapshots, multi-timeframe confluence, explicit candle-pattern evidence, and auditability rather than competing on autonomous order execution.
3. Signal scoring should be standardized, for example on a bounded bullish-to-bearish scale, but must preserve the underlying evidence and confidence/quality metadata so the score is not a black box.
4. Any vendor-reported user counts, plan limits, pricing, or exchange counts should be treated as marketing claims and re-verified during implementation procurement.

## Open-source landscape

### Freqtrade
Source: https://github.com/freqtrade/freqtrade

The official repository describes Freqtrade as a free, open-source Python crypto trading bot designed for major exchanges and controllable through Telegram or web UI. It includes OHLCV data download/conversion, backtesting, plotting, strategy optimization, dry-run, persistence, whitelist/blacklist controls, Telegram management, and an optional adaptive FreqAI machine-learning component. The repository explicitly recommends dry-run before risking funds. Its published README lists spot and futures exchange support, but actual support depends on exchange-specific notes and current compatibility.

### Hummingbot
Source: https://github.com/hummingbot/hummingbot

The official repository describes Hummingbot as an Apache-2.0 open-source framework for deploying automated strategies across centralized and decentralized exchanges. It provides connectors, scripts, reusable controllers, paper trading, a CLI, API integrations, and modular strategy/executor components. The project emphasizes market-making and exchange connectivity more than candle-pattern signal interpretation, but its connector abstraction and paper-trading model are useful architectural references. The repository also documents Telegram/web control through the related Condor AI harness and API ecosystem; this should be verified separately before adopting.

### Jesse
Source: https://github.com/jesse-ai/jesse

The official repository describes Jesse as an MIT-licensed Python crypto trading framework for researching, defining, backtesting, optimizing, and live-running strategies. It advertises multi-timeframe and multi-symbol workflows without look-ahead bias, a technical-indicator library, risk management, metrics, alerts, interactive charts, rule-significance testing, Monte Carlo analysis, machine-learning workflows, and a research API/Jupyter path. It also reports Telegram/Slack/Discord notifications in live/paper workflows. This is a strong reference for research reproducibility and evaluation, although it is oriented toward strategy development and execution rather than Telegram-native end-user control.

### TA-Lib
Source: https://ta-lib.org/

The official site describes TA-Lib as an open-source BSD-licensed technical-analysis library with approximately 200 indicators, candlestick pattern recognition, a C/C++ core, and language wrappers. It is a credible candidate for standardized indicator and classic candlestick calculations, subject to deployment/runtime compatibility and independent validation on the exact OHLCV conventions used by the product.

## OSS design implications

1. Reuse the conceptual separation found in mature OSS projects: market-data adapters, normalized candle store, indicators/patterns, strategy/rule engine, backtesting/evaluation, alerting, and user control.
2. Start with a signals-only architecture even if future execution is possible. This removes exchange private-key handling from the first release and reduces blast radius.
3. Treat TA-Lib or equivalent libraries as calculation primitives, not as a full methodology. Wyckoff, Elliott Wave, SMC, and composite scoring require a domain-specific, versioned rule layer with explicit evidence.
4. Incorporate dry-run/paper mode, look-ahead-bias checks, walk-forward evaluation, and audit logs from the beginning; these are repeated themes in mature open-source frameworks.
5. If using OSS code, perform a license review. Freqtrade is open source, Hummingbot is Apache-2.0, Jesse is MIT, and TA-Lib advertises BSD licensing. Reuse should be isolated and documented rather than copied casually.

## Methodology and pattern references

### Wyckoff Analytics
Source: https://www.wyckoffanalytics.com/wyckoff-method/

The source presents Wyckoff as a price/volume and market-structure methodology with a five-step approach: determine market position and probable trend; select instruments in harmony with the trend; select instruments with sufficient cause; determine readiness to move; and time commitment with a market turn. It describes accumulation/distribution trading ranges, events, phases, supply-and-demand analysis, comparative strength, and Point-and-Figure cause/effect projections. For implementation, these should be treated as evidence-generating rule families rather than a single binary indicator.

### StockCharts Candlestick Pattern Dictionary
Source: https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary

The source defines the requested pattern families and stresses contextual interpretation. A doji reflects an open and close that are virtually equal and conveys indecision. Hammer and hanging-man shapes share a long lower shadow but are named by context: decline versus advance. A bullish/bearish engulfing pattern depends on trend context and the second real body engulfing the previous real body. Morning star and evening star are three-candle reversal structures with a long first body, a small middle body, and a decisive third body. Shooting star is an upper-shadow reversal pattern in an uptrend and resembles an inverted hammer structurally but differs in context. The page also lists harami, spinning top, three black crows, and three white soldiers among its dictionary entries.

## Methodology implementation caution

Wyckoff, Elliott Wave, and SMC are interpretive frameworks with ambiguous labeling and regime dependence. The product should expose the exact rule version, evidence window, detected pivots/levels, and invalidation criteria. The system must not present these frameworks as deterministic forecasts or as proof of institutional intent. Elliott Wave labels should initially be experimental/optional because automated wave-counting is highly sensitive to pivot definitions and degree selection. SMC concepts should be defined narrowly as observable proxies such as swing break, displacement, imbalance/gap, and retest; avoid untestable claims about actual institutional orders.
