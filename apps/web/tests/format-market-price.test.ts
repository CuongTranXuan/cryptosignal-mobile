import { describe, expect, it } from "vitest";
import { formatMarketPrice, tickSizeForSymbol } from "../lib/format-market-price";

describe("formatMarketPrice", () => {
  it("formats BTCUSDT with tick 0.01 like chart scale", () => {
    expect(tickSizeForSymbol("BTCUSDT")).toBe(0.01);
    expect(formatMarketPrice(81056.36163113132, "BTCUSDT")).toBe("81,056.36");
  });
});
