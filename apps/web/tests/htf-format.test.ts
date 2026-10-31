import { describe, expect, it } from "vitest";
import { formatMetaHtfLine, formatUnixSecondsLocal } from "../lib/htf-format";

describe("htf-format", () => {
  it("formats last closed candle close time in local locale", () => {
    const label = formatUnixSecondsLocal(1_700_000_000, "en-US");
    expect(label).toMatch(/\d/);
  });

  it("includes regime and close time from meta.htf", () => {
    const line = formatMetaHtfLine({
      model: "m",
      candle_count_requested: 1,
      candle_count_used: 1,
      clamped: false,
      htf: {
        interval: "4h",
        regime: "trend_down",
        last_closed_time: 1_700_000_000,
        last_closed_open_time: 1_699_985_600,
      },
    });
    expect(line).toContain("4h");
    expect(line).toContain("nến đóng lúc");
  });
});
