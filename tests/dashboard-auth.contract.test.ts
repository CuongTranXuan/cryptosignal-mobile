import { describe, expect, it } from "vitest";

import { hashPassword, normalizeUsername, verifyPassword } from "../server/dashboard-auth";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

const unauthenticatedContext: TrpcContext = {
  user: null,
  dashboardUser: null,
  req: {} as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("dashboard credential and authorization contract", () => {
  it("normalizes usernames and uses a salted non-plaintext password representation", async () => {
    const hash = await hashPassword("a-long-password-for-testing");
    expect(normalizeUsername(" Owner.User ")).toBe("owner.user");
    expect(hash).toMatch(/^pbkdf2\$sha256\$310000\$/);
    expect(hash).not.toContain("a-long-password-for-testing");
    await expect(verifyPassword("a-long-password-for-testing", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password-value", hash)).resolves.toBe(false);
  });

  it("rejects unauthenticated dashboard data access", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext);
    await expect(caller.signal.latest()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.market.chart({ assetSymbol: "BTC/USDT", timeframe: "1h", limit: 30 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
