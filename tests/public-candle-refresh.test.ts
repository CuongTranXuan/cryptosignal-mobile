import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPublicResearchWindow, parseClosedBinanceCandles, refreshPublicCandleResearch } from "../server/public-candle-refresh";
import { CANDLE_PATTERN_RULE_IDS, METHODOLOGY_RULE_IDS, type BotConfigView } from "../shared/signal-types";
import * as signalDb from "../server/db";

const config: BotConfigView = {
  configVersion: 1,
  lastChangedBy: "DASHBOARD" as const,
  isPaused: false,
  watchlist: ["BTC/USDT"],
  timeframes: ["1h"],
  ruleFamilies: ["TREND", "MOMENTUM", "VOLUME", "CANDLE_PATTERN"],
  enabledPatterns: [...CANDLE_PATTERN_RULE_IDS],
  enabledMethodologies: [...METHODOLOGY_RULE_IDS],
  liveAlerts: { enabled: false, conditionIds: [], threshold: 0.65, cooldownMinutes: 15 },
  alertThreshold: 0.35,
  cooldownMinutes: 60,
  quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
};

function kline(index: number, closeTime: number) {
  const close = 100 + index * 0.4;
  return [closeTime - 3_600_000, String(close - 0.2), String(close + 0.8), String(close - 0.8), String(close), "120", closeTime, "0", 0, "0", "0", "0"];
}

describe("public candle refresh calculation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops the still-open public candle before calculation", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const candles = parseClosedBinanceCandles([kline(1, now - 1), kline(2, now + 3_600_000)], now);
    expect(candles).toHaveLength(1);
    expect(candles[0].closeTime).toBe(now - 1);
  });

  it("builds valid chart history and a signals-only snapshot from closed public candles", () => {
    const start = Date.UTC(2025, 11, 1, 0, 0, 0);
    const candles = Array.from({ length: 240 }, (_, index) => ({
      openTime: start + index * 3_600_000 - 3_600_000,
      closeTime: start + index * 3_600_000,
      open: 100 + index * 0.4 - 0.2,
      high: 100 + index * 0.4 + 0.8,
      low: 100 + index * 0.4 - 0.8,
      close: 100 + index * 0.4,
      volume: 120 + (index % 5),
    }));
    const result = buildPublicResearchWindow("BTC/USDT", "1h", config, candles);
    expect(result.history).toHaveLength(240);
    expect(result.history.at(-1)?.candleCloseTime).toBe(new Date(candles.at(-1)!.closeTime).toISOString());
    expect(result.snapshot.dataQualityState).toBe("PUBLIC_CLOSED_CANDLES");
    expect(result.snapshot.strategyVersion).toBe("PUBLIC_OHLCV_V1");
    expect(result.snapshot.state).toBe("BULLISH_SETUP");
    expect(result.snapshot.findings.length).toBeGreaterThan(1);
  });

  it("emits only a selected named closed-candle pattern when its parent family is enabled", () => {
    const start = Date.UTC(2025, 11, 1, 0, 0, 0);
    const candles = Array.from({ length: 240 }, (_, index) => ({
      openTime: start + index * 3_600_000 - 3_600_000,
      closeTime: start + index * 3_600_000,
      open: 100 + index * 0.2 - 0.1,
      high: 100 + index * 0.2 + 0.3,
      low: 100 + index * 0.2 - 0.3,
      close: 100 + index * 0.2,
      volume: 120,
    }));
    const latest = candles.at(-1)!;
    latest.open = latest.close - 0.2;
    latest.high = latest.close;
    latest.low = latest.close - 5;
    const result = buildPublicResearchWindow("BTC/USDT", "1h", { ...config, ruleFamilies: ["CANDLE_PATTERN"], enabledPatterns: ["HAMMER_V1"] }, candles);
    expect(result.snapshot.findings.map((finding) => finding.ruleId)).toEqual(["HAMMER_V1"]);
  });

  it("refreshes from a public response without exchange credentials or order execution", async () => {
    const start = Date.UTC(2025, 11, 1, 0, 0, 0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(Array.from({ length: 240 }, (_, index) => kline(index, start + index * 3_600_000))), { status: 200 })));
    const getConfig = vi.spyOn(signalDb, "getBotConfig").mockResolvedValue({ ...config, isPaused: false });
    try {
      const result = await refreshPublicCandleResearch({ assetSymbol: "BTC/USDT", timeframe: "1h" });
      expect(result.ok).toBe(true);
      expect(result.paused).toBe(false);
      expect(result.candlesRecorded).toBe(240);
      expect(result.snapshot?.venue).toBe("BINANCE_PUBLIC");
    } finally {
      getConfig.mockRestore();
    }
  });
});
