import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";

function createCaller() {
  return appRouter.createCaller({ user: null, dashboardUser: { id: 1, username: "test-owner", role: "admin" }, req: {} as never, res: {} as never });
}

describe("signals-only backend integration", () => {
  it("reports a non-executing long-polling runtime", async () => {
    const status = await createCaller().bot.status();
    expect(status.mode).toBe("SIGNALS_ONLY");
    expect(status.executionEnabled).toBe(false);
    expect(status.telegramMode).toBe("LONG_POLLING");
    expect(status.telegramPoller).toMatchObject({ state: expect.any(String) });
    expect(status.telegramPoller).toHaveProperty("lastError");
  });

  it("returns persisted signal snapshots through the protected dashboard read model", async () => {
    const signals = await createCaller().signal.list({ limit: 5 });
    expect(Array.isArray(signals)).toBe(true);
    if (signals[0]) {
      expect(signals[0]).toMatchObject({ assetSymbol: expect.any(String), state: expect.any(String) });
    }
  });

  it("accepts dashboard configuration changes and records the dashboard as the shared control surface", async () => {
    const caller = createCaller();
    const updated = await caller.bot.controls.setTimeframes({ timeframes: ["30m", "1h"] });
    expect(updated.timeframes).toEqual(["30m", "1h"]);
    expect(updated.lastChangedBy).toBe("DASHBOARD");

    const paused = await caller.bot.controls.setPaused({ isPaused: true });
    expect(paused).toMatchObject({ isPaused: true, lastChangedBy: "DASHBOARD" });
  });

  it("accepts a 30-minute closed-candle chart window", async () => {
    const chart = await createCaller().market.chart({ assetSymbol: "BTC/USDT", timeframe: "30m", limit: 30 });
    expect(chart).toMatchObject({ candles: expect.any(Array), signals: expect.any(Array), scenarios: expect.any(Array) });
  });
});
