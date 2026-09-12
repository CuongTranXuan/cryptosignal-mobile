# CryptoSignal

A lightweight chart platform for **people** and **LLM agents** to draw candle patterns on the same market view.

## What it is

1. **Binance MCP** supplies public candle data.
2. **TradingView Lightweight Charts** renders the candles.
3. **Humans** draw and edit patterns on the chart.
4. **LLM agents** draw the same patterns through a structured API.

Both surfaces share one annotation model, so a pattern drawn by an agent looks the same as one drawn by a person.

```
Binance MCP  -->  candles  -->  Lightweight Charts
                                   ^
                                   |
                      human UI  +  agent drawing API
```

## Boundary

This is a research chart, not a trading terminal. No order placement, no exchange private keys, no portfolio or execution.

## Status

Clean restart. Implementation starts from this README.
