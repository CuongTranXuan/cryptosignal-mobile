import type { PatternShape } from "./pattern-shape";

/** Minimal geometry payload for copilot feedback `before` / `after`. */
export function shapeFeedbackSnapshot(shape: PatternShape): Record<string, unknown> {
  return {
    id: shape.id,
    kind: shape.kind,
    points: shape.points,
    priceLow: shape.priceLow,
    priceHigh: shape.priceHigh,
  };
}
