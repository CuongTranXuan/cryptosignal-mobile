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
  });

  it("returns persisted signal snapshots through the protected dashboard read model", async () => {
    const signals = await createCaller().signal.list({ limit: 5 });
    expect(Array.isArray(signals)).toBe(true);
    if (signals[0]) {
      expect(signals[0]).toMatchObject({ assetSymbol: expect.any(String), state: expect.any(String) });
    }
  });
});
