import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("live market panel", () => {
  it("renders an explicit unconfirmed badge and never reuses confirmed closed-candle copy", () => {
    const source = readFileSync(resolve(process.cwd(), "components/live-market-panel.tsx"), "utf8");

    expect(source).toContain('t("liveUnconfirmedBadge")');
    expect(source).toContain("LIVE_UNCONFIRMED");
    expect(source).not.toContain("Confirmed closed-candle research");
  });
});
