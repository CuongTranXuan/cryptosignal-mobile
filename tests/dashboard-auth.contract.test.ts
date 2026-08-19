import { describe, expect, it } from "vitest";

import { DEMO_PASSWORD, DEMO_USERNAME, isDemoCredentialPair, normalizeUsername } from "../server/dashboard-auth";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

const unauthenticatedContext: TrpcContext = { user: null, dashboardUser: null, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };

describe("dashboard demo access contract", () => {
  it("accepts only the documented default demo pair without username or password length constraints", () => {
    expect(DEMO_USERNAME).toBe("user");
    expect(DEMO_PASSWORD).toBe("password");
    expect(normalizeUsername(" USER ")).toBe("user");
    expect(isDemoCredentialPair("user", "password")).toBe(true);
    expect(isDemoCredentialPair("user", "different")).toBe(false);
  });

  it("allows anonymous read-only dashboard data access", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext);
    await expect(caller.bot.status()).resolves.toMatchObject({ executionEnabled: false, mode: "SIGNALS_ONLY" });
  });
});
