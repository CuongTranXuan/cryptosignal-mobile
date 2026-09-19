import { describe, expect, it } from "vitest";
import { coerceAgentShape } from "../lib/normalize-agent-shape";
import { PatternShapeSchema } from "../lib/pattern-shape";

describe("coerceAgentShape", () => {
  it("maps type/label/color LLM shapes into PatternShape", () => {
    const coerced = coerceAgentShape(
      {
        type: "polyline",
        label: "Sym triangle upper",
        color: "#ef5350",
        points: [
          { time: 1788735600, price: 80559 },
          { time: 1788940800, price: 79760 },
          { time: 1789149600, price: 78947 },
        ],
      },
      { symbol: "BTCUSDT", interval: "1h" },
    );
    const parsed = PatternShapeSchema.safeParse(coerced);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("polyline");
      expect(parsed.data.name).toBe("Sym triangle upper");
      expect(parsed.data.source).toBe("agent");
      expect(parsed.data.symbol).toBe("BTCUSDT");
    }
  });

  it("coerces 2-point polyline to trendline", () => {
    const coerced = coerceAgentShape(
      {
        type: "polyline",
        label: "upper",
        points: [
          { time: 1, price: 10 },
          { time: 2, price: 20 },
        ],
      },
      { symbol: "BTCUSDT", interval: "1h" },
    );
    const parsed = PatternShapeSchema.parse(coerced);
    expect(parsed.kind).toBe("trendline");
  });
});
