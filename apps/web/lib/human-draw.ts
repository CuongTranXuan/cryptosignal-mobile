import type { Interval, PatternShape } from "./pattern-shape";
import type { DrawTool } from "./stores/draw-tool-store";

type Point = PatternShape["points"][number];

export function newHumanShapeId(kind: PatternShape["kind"]): string {
  return `human_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function buildHumanShape(args: {
  tool: Exclude<DrawTool, "none">;
  points: Point[];
  symbol: string;
  interval: Interval;
}): PatternShape | null {
  const { tool, points, symbol, interval } = args;
  if (tool === "trendline") {
    if (points.length !== 2) return null;
    return {
      id: newHumanShapeId("trendline"),
      symbol,
      interval,
      kind: "trendline",
      name: "Human trendline",
      status: "committed",
      source: "human",
      confidence: 1,
      points,
      priceLow: null,
      priceHigh: null,
    };
  }
  if (tool === "polyline") {
    if (points.length < 3) return null;
    return {
      id: newHumanShapeId("polyline"),
      symbol,
      interval,
      kind: "polyline",
      name: "Human polyline",
      status: "committed",
      source: "human",
      confidence: 1,
      points,
      priceLow: null,
      priceHigh: null,
    };
  }
  // zone: two corners → time span + price band
  if (points.length !== 2) return null;
  const [a, b] = points;
  const priceLow = Math.min(a.price, b.price);
  const priceHigh = Math.max(a.price, b.price);
  if (!(priceLow < priceHigh)) return null;
  return {
    id: newHumanShapeId("zone"),
    symbol,
    interval,
    kind: "zone",
    name: "Human zone",
    status: "committed",
    source: "human",
    confidence: 1,
    points: [a, b],
    priceLow,
    priceHigh,
  };
}

export function shouldAutoCommit(tool: DrawTool, pointCount: number): boolean {
  if (tool === "trendline" || tool === "zone") return pointCount >= 2;
  return false;
}
