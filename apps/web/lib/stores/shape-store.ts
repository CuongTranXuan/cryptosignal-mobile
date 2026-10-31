import { create } from "zustand";
import type { PatternShape } from "../pattern-shape";

type Point = PatternShape["points"][number];

/** First occurrence wins; keeps order. */
export function uniqueShapesById(shapes: PatternShape[]): PatternShape[] {
  const seen = new Set<string>();
  return shapes.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

/** User-drawn, kept ("Giữ") or edited shapes survive a new analyze run (chart-history contract). */
export function isPinnedShape(shape: PatternShape): boolean {
  return shape.source === "human" || shape.origin === "user" || shape.kept === true || shape.edited === true;
}

/** `origin` from the wire, or derived from `source` for shapes from older payloads. */
export function shapeOrigin(shape: PatternShape): "ai" | "user" {
  return shape.origin ?? (shape.source === "human" ? "user" : "ai");
}

type UserEditListener = () => void;
let userEditListener: UserEditListener | null = null;

/** Called after every user edit (draw, keep, drag/resize, delete/reject); not for programmatic paints. */
export function setShapeUserEditListener(listener: UserEditListener | null): void {
  userEditListener = listener;
}

function notifyUserEdit(): void {
  userEditListener?.();
}

type ShapeState = {
  shapes: PatternShape[];
  selectedId: string | null;
  setPreview: (shapes: PatternShape[]) => void;
  commitPreview: () => void;
  /**
   * New analyze run (N24): drop the previous run's AI shapes unless pinned, keep pinned
   * shapes, then add `incoming` (deduped; an id that is already pinned is skipped so the
   * user's version wins). Returns the shapes actually added.
   */
  replaceAgentShapes: (incoming: PatternShape[]) => PatternShape[];
  /** Paint a saved chart state (no user-edit notification). */
  setChartShapes: (shapes: PatternShape[]) => void;
  keep: (id: string) => void;
  patchPoints: (id: string, points: Point[]) => void;
  patchZone: (id: string, low: number, high: number) => void;
  select: (id: string | null) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  addCommitted: (shape: PatternShape) => void;
  committed: () => PatternShape[];
  previews: () => PatternShape[];
};

export const useShapeStore = create<ShapeState>((set, get) => ({
  shapes: [],
  selectedId: null,

  setPreview: (shapes) => {
    const committed = get().shapes.filter((s) => s.status === "committed");
    const committedIds = new Set(committed.map((s) => s.id));
    const previews = uniqueShapesById(shapes)
      .filter((s) => !committedIds.has(s.id))
      .map((s) => ({ ...s, status: "preview" as const }));
    set({ shapes: [...committed, ...previews] });
  },

  commitPreview: () => {
    set({
      shapes: get().shapes.map((s) =>
        s.status === "preview" ? { ...s, status: "committed" as const } : s,
      ),
    });
  },

  replaceAgentShapes: (incoming) => {
    const { shapes, selectedId } = get();
    const kept = shapes.filter((s) => s.status === "committed" && isPinnedShape(s));
    const keptIds = new Set(kept.map((s) => s.id));
    const added = uniqueShapesById(incoming)
      .filter((s) => !keptIds.has(s.id))
      .map((s) => ({ ...s, status: "committed" as const }));
    const next = [...kept, ...added];
    const nextIds = new Set(next.map((s) => s.id));
    set({
      shapes: next,
      selectedId: selectedId && nextIds.has(selectedId) ? selectedId : null,
    });
    return added;
  },

  setChartShapes: (shapes) => {
    const next = uniqueShapesById(shapes).map((s) => ({ ...s, status: "committed" as const }));
    const selectedId = get().selectedId;
    set({
      shapes: next,
      selectedId: selectedId && next.some((s) => s.id === selectedId) ? selectedId : null,
    });
  },

  keep: (id) => {
    const target = get().shapes.find((s) => s.id === id);
    if (!target || target.kept) return;
    set({ shapes: get().shapes.map((s) => (s.id === id ? { ...s, kept: true } : s)) });
    notifyUserEdit();
  },

  patchPoints: (id, points) => {
    set({
      shapes: get().shapes.map((s) => (s.id === id ? { ...s, points, edited: true } : s)),
    });
    notifyUserEdit();
  },

  patchZone: (id, low, high) => {
    set({
      shapes: get().shapes.map((s) =>
        s.id === id ? { ...s, priceLow: low, priceHigh: high, edited: true } : s,
      ),
    });
    notifyUserEdit();
  },

  select: (id) => set({ selectedId: id }),

  remove: (id) => {
    const { shapes, selectedId } = get();
    if (!shapes.some((s) => s.id === id)) return;
    set({
      shapes: shapes.filter((s) => s.id !== id),
      selectedId: selectedId === id ? null : selectedId,
    });
    notifyUserEdit();
  },

  clearAll: () => set({ shapes: [], selectedId: null }),

  addCommitted: (shape) => {
    const committed = { ...shape, status: "committed" as const };
    set({
      shapes: [...get().shapes.filter((s) => s.id !== committed.id), committed],
      selectedId: committed.id,
    });
    notifyUserEdit();
  },

  committed: () => get().shapes.filter((s) => s.status === "committed"),

  previews: () => get().shapes.filter((s) => s.status === "preview"),
}));
