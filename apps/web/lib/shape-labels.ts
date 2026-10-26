import { displayShapeName } from "./copilot-display";
import type { PatternShape } from "./pattern-shape";

/** Vietnamese names from the SSE `shapes` event (`labels: {id: name}`); `name` stays canonical. */
const labels = new Map<string, string>();

export function rememberShapeLabels(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  for (const [id, label] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof label === "string" && label.trim()) labels.set(id, label.trim());
  }
}

/** Server label for this shape id, else the local mapping of its canonical name. */
export function shapeDisplayName(shape: Pick<PatternShape, "id" | "name">): string {
  return labels.get(shape.id) ?? displayShapeName(shape.name);
}

export function resetShapeLabelsForTests(): void {
  labels.clear();
}
