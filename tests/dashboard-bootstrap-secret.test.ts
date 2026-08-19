import { describe, expect, it } from "vitest";

import { DEMO_PASSWORD, DEMO_USERNAME, isDemoCredentialPair } from "../server/dashboard-auth";

describe("demo access", () => {
  it("does not require a bootstrap secret", () => {
    expect(isDemoCredentialPair(DEMO_USERNAME, DEMO_PASSWORD)).toBe(true);
  });
});
