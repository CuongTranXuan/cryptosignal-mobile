import { describe, expect, it } from "vitest";
import {
  BINANCE_REST,
  BINANCE_WS,
  klineStreamUrl,
  klinesUrl,
  mergeCandles,
  normalizeSpotSymbol,
  parseKlineRestRow,
  parseWsKline,
  tickerUrl,
} from "../lib/binance";
import type { Candle } from "../lib/pattern-shape";

describe("binance", () => {
  it("normalizes BTC/USDT", () => {
    expect(normalizeSpotSymbol("btc/usdt")).toBe("BTCUSDT");
    expect(normalizeSpotSymbol("nope")).toBeNull();
  });

  it("parses rest kline", () => {
    const c = parseKlineRestRow([
      1710000000000,
      "1",
      "2",
      "0.5",
      "1.5",
      "10",
      0,
      "0",
      0,
      "0",
      "0",
      "0",
    ]);
    expect(c.time).toBe(1710000000);
    expect(c.close).toBe(1.5);
  });

  it("ws closed flag", () => {
    const parsed = parseWsKline({
      s: "BTCUSDT",
      k: { t: 1710000000000, o: "1", h: "2", l: "0.5", c: "1.5", v: "10", x: true, i: "1h" },
    });
    expect(parsed?.closed).toBe(true);
  });

  it("stream url", () => {
    expect(klineStreamUrl("BTCUSDT", "1h")).toBe(
      "wss://stream.binance.com:9443/ws/btcusdt@kline_1h",
    );
  });

  it("builds rest urls", () => {
    expect(BINANCE_REST).toBe("https://api.binance.com");
    expect(BINANCE_WS).toBe("wss://stream.binance.com:9443/ws");
    expect(klinesUrl("BTCUSDT", "1h")).toBe(
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=500",
    );
    expect(klinesUrl("ETHUSDT", "15m", 100)).toBe(
      "https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=15m&limit=100",
    );
    expect(
      klinesUrl("BTCUSDT", "1h", { limit: 1000, startTimeMs: 1000, endTimeMs: 2000 }),
    ).toBe(
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&startTime=1000&endTime=2000",
    );
    expect(tickerUrl("BTCUSDT")).toBe(
      "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
    );
  });

  it("merges candles sorted unique by time", () => {
    const existing: Candle[] = [
      { time: 200, open: 2, high: 3, low: 1, close: 2.5, volume: 5 },
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    ];
    const incoming: Candle[] = [
      { time: 100, open: 1, high: 2.2, low: 0.4, close: 1.8, volume: 12 },
      { time: 300, open: 3, high: 4, low: 2.5, close: 3.5, volume: 7 },
    ];
    expect(mergeCandles(existing, incoming)).toEqual([
      { time: 100, open: 1, high: 2.2, low: 0.4, close: 1.8, volume: 12 },
      { time: 200, open: 2, high: 3, low: 1, close: 2.5, volume: 5 },
      { time: 300, open: 3, high: 4, low: 2.5, close: 3.5, volume: 7 },
    ]);
  });

  it("parseWsKline returns null for invalid payload", () => {
    expect(parseWsKline(null)).toBeNull();
    expect(parseWsKline({})).toBeNull();
  });
});
