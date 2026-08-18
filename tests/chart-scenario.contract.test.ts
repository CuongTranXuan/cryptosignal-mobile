import { describe, expect, it } from "vitest";
import { buildConditionalScenarios } from "../server/db";
import { candlePointSchema } from "../server/signal-ingest";

const candle = {
  id: "candle_0123456789abcdef",
  assetSymbol: "BTC/USDT",
  venue: "binance_spot_public",
  timeframe: "1h",
  candleCloseTime: "2026-08-18T10:00:00Z",
  open: 64000, high: 65000, low: 63500, close: 64500, volume: 300,
  ema20: 64200, ema50: 63800, ema200: 62000, rsi14: 58, macd: 12, macdSignal: 9, atr14: 700,
  signalState: "BULLISH_SETUP", signalScore: 0.6,
  strategyVersion: "0.1.0", configVersion: 1,
};

describe("chart history and conditional outlook contract", () => {
  it("accepts normalized completed candles with chart indicator values", () => {
    expect(candlePointSchema.safeParse(candle).success).toBe(true);
  });

  it("rejects invalid OHLCV and out-of-range signal values", () => {
    expect(candlePointSchema.safeParse({ ...candle, low: -1 }).success).toBe(false);
    expect(candlePointSchema.safeParse({ ...candle, signalScore: 2 }).success).toBe(false);
  });

  it("emits conditional research scenarios with invalidation and no imperative trade language", () => {
    const scenarios = buildConditionalScenarios({ close: 64500, atr14: 700, ema20: 64200, ema50: 63800, rsi14: 58, signalState: "BULLISH_SETUP", signalScore: 0.6 }, "1h");
    expect(scenarios).toHaveLength(3);
    expect(scenarios.every((scenario) => scenario.invalidation.length > 0 && scenario.researchWindow.includes("completed"))).toBe(true);
    expect(JSON.stringify(scenarios).toLowerCase()).not.toMatch(/\b(buy|sell|guarantee|recommend)\b/);
  });
});
