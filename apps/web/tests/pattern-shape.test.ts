import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePatternShape, PatternShapeSchema } from "../lib/pattern-shape";

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

  it("rejects trendline with one point", () => {
    expect(() =>
      parsePatternShape({ ...fixture, kind: "trendline", points: [fixture.points[0]] }),
    ).toThrow();
  });
});
