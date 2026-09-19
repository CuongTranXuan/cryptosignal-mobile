import { describe, expect, it } from "vitest";
import { buildHumanShape, shouldAutoCommit } from "../lib/human-draw";
import { parsePatternShape } from "../lib/pattern-shape";

const pts = [
  { time: 1710000000, price: 100 },
  { time: 1710003600, price: 110 },
  { time: 1710007200, price: 105 },
];

describe("human-draw", () => {
  it("builds trendline after 2 points", () => {
    const shape = buildHumanShape({
      tool: "trendline",
      points: pts.slice(0, 2),
      symbol: "BTCUSDT",
      interval: "1h",
    });
    expect(shape?.kind).toBe("trendline");
    expect(shape?.source).toBe("human");
    expect(shape?.status).toBe("committed");
  });

  it("builds zone from two corners", () => {
    const shape = buildHumanShape({
      tool: "zone",
      points: pts.slice(0, 2),
      symbol: "BTCUSDT",
      interval: "1h",
    });
    expect(shape?.kind).toBe("zone");
    expect(shape?.priceLow).toBe(100);
    expect(shape?.priceHigh).toBe(110);
  });

  it("auto-commits trendline/zone at 2 points", () => {
    expect(shouldAutoCommit("trendline", 2)).toBe(true);
    expect(shouldAutoCommit("zone", 2)).toBe(true);
    expect(shouldAutoCommit("polyline", 3)).toBe(false);
  });

  it("parses human source shapes", () => {
    const shape = buildHumanShape({
      tool: "trendline",
      points: pts.slice(0, 2),
      symbol: "BTCUSDT",
      interval: "1h",
    });
    expect(parsePatternShape(shape!).source).toBe("human");
  });
});
