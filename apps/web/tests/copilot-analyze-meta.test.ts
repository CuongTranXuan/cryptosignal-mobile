import { describe, expect, it } from "vitest";
import { formatAnalyzeMetaNotice } from "../lib/copilot-analyze-meta";

describe("formatAnalyzeMetaNotice", () => {
  it("explains server-side clamp with requested vs used", () => {
    const text = formatAnalyzeMetaNotice({
      model: "provider-a/model-alpha",
      candle_count_requested: 100,
      candle_count_used: 50,
      clamped: true,
    });
    expect(text).toContain("100");
    expect(text).toContain("50");
  });
});
