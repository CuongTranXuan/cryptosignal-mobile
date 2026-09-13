import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CandleSchema, parsePatternShape } from "../lib/pattern-shape";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../packages/schema/pattern-shape.fixture.json"), "utf8"),
);

describe("PatternShape", () => {
  it("parses the shared fixture", () => {
    const shape = parsePatternShape(fixture);
    expect(shape.kind).toBe("polyline");
    expect(shape.points).toHaveLength(3);
  });

  it("rejects order-like keys", () => {
    expect(() => parsePatternShape({ ...fixture, side: "BUY", quantity: 1 })).toThrow();
  });

  it("rejects unknown keys on points and candles", () => {
    expect(() =>
      parsePatternShape({
        ...fixture,
        points: [{ ...fixture.points[0], extra: true }],
      }),
    ).toThrow();

    expect(() =>
      CandleSchema.parse({
        time: 1,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        extra: true,
      }),
    ).toThrow();
  });

  it("rejects trendline with one point", () => {
    expect(() =>
      parsePatternShape({ ...fixture, kind: "trendline", points: [fixture.points[0]] }),
    ).toThrow();
  });
});
