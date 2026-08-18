import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({
  getBotConfig: vi.fn().mockResolvedValue({
    configVersion: 1,
    isPaused: false,
    watchlist: ["BTC/USDT"],
    timeframes: ["1h"],
    ruleFamilies: ["TREND"],
    alertThreshold: 0.55,
    cooldownMinutes: 60,
    quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
  }),
  hasRecentSignalAlert: vi.fn().mockResolvedValue(false),
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
  getTelegramUpdateOffset: vi.fn().mockResolvedValue(0),
  listSignalSnapshots: vi.fn().mockResolvedValue([]),
  setBotPaused: vi.fn(),
  setTelegramUpdateOffset: vi.fn(),
  updateBotConfig: vi.fn(),
}));

import { deliverSignalAlert } from "../server/telegram-polling";

describe("Telegram delivery resilience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns a Telegram 400 into a non-fatal delivery result", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_USER_IDS = "123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, description: "chat not found" }) }));

    await expect(
      deliverSignalAlert({
        id: "sig_delivery_resilience",
        assetSymbol: "BTC/USDT",
        venue: "binance_spot_public",
        timeframe: "1h",
        candleCloseTime: "2026-08-18T10:00:00Z",
        state: "BULLISH_SETUP",
        score: 0.8,
        confidence: 0.8,
        regime: "TREND_UP",
        dataQualityState: "PASS",
        findings: [],
        conflicts: [],
        invalidation: { price: 1 },
        strategyVersion: "0.1.0",
        configVersion: 1,
        sourceManifestId: "source_delivery_resilience",
      }),
    ).resolves.toEqual({ delivered: false, reason: "DELIVERY_FAILED" });
  });
});
