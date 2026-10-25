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

type ShapeState = {
  shapes: PatternShape[];
  selectedId: string | null;
  /** AI shapes the user kept ("Giữ") or edited; a new analyze run does not replace them. */
  pinnedIds: Record<string, true>;
  setPreview: (shapes: PatternShape[]) => void;
  commitPreview: () => void;
  /**
   * New analyze run (N24): drop the previous run's AI shapes unless pinned, keep human and
   * pinned shapes, then add `incoming` (deduped; an id that is already kept is skipped so the
   * user's version wins). Returns the shapes actually added.
   */
  replaceAgentShapes: (incoming: PatternShape[]) => PatternShape[];
  pin: (id: string) => void;
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
  pinnedIds: {},

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
    const { shapes, pinnedIds, selectedId } = get();
    const kept = shapes.filter(
      (s) => s.status === "committed" && (s.source === "human" || pinnedIds[s.id]),
    );
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

  pin: (id) => {
    if (get().pinnedIds[id]) return;
    set({ pinnedIds: { ...get().pinnedIds, [id]: true } });
  },

  patchPoints: (id, points) => {
    set({
      shapes: get().shapes.map((s) => (s.id === id ? { ...s, points } : s)),
    });
    get().pin(id);
  },

  patchZone: (id, low, high) => {
    set({
      shapes: get().shapes.map((s) =>
        s.id === id ? { ...s, priceLow: low, priceHigh: high } : s,
      ),
    });
    get().pin(id);
  },

  select: (id) => set({ selectedId: id }),

  remove: (id) => {
    const { shapes, selectedId, pinnedIds } = get();
    const { [id]: _removed, ...restPinned } = pinnedIds;
    set({
      shapes: shapes.filter((s) => s.id !== id),
      selectedId: selectedId === id ? null : selectedId,
      pinnedIds: restPinned,
    });
  },

  clearAll: () => set({ shapes: [], selectedId: null, pinnedIds: {} }),

  addCommitted: (shape) => {
    const committed = { ...shape, status: "committed" as const };
    set({
      shapes: [...get().shapes.filter((s) => s.id !== committed.id), committed],
      selectedId: committed.id,
    });
  },

  committed: () => get().shapes.filter((s) => s.status === "committed"),

  previews: () => get().shapes.filter((s) => s.status === "preview"),
}));
