import { describe, expect, it } from "vitest";
import { validateDashboardBootstrapToken } from "../server/dashboard-auth";

describe("dashboard bootstrap secret", () => {
  it("is accepted by the bootstrap validation contract", async () => {
    const bootstrapToken = process.env.DASHBOARD_BOOTSTRAP_TOKEN;
    expect(bootstrapToken).toBeTruthy();
    expect(validateDashboardBootstrapToken(bootstrapToken!)).toBe(true);
    expect(validateDashboardBootstrapToken(`${bootstrapToken}x`)).toBe(false);
  });
});
