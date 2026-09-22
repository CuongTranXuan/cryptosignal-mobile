import { create } from "zustand";
import type { PatternShape } from "../pattern-shape";

type Point = PatternShape["points"][number];

type ShapeState = {
  shapes: PatternShape[];
  selectedId: string | null;
  setPreview: (shapes: PatternShape[]) => void;
  commitPreview: () => void;
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
    const previews = shapes.map((s) => ({ ...s, status: "preview" as const }));
    set({ shapes: [...committed, ...previews] });
  },

  commitPreview: () => {
    set({
      shapes: get().shapes.map((s) =>
        s.status === "preview" ? { ...s, status: "committed" as const } : s,
      ),
    });
  },

  patchPoints: (id, points) => {
    set({
      shapes: get().shapes.map((s) => (s.id === id ? { ...s, points } : s)),
    });
  },

  patchZone: (id, low, high) => {
    set({
      shapes: get().shapes.map((s) =>
        s.id === id ? { ...s, priceLow: low, priceHigh: high } : s,
      ),
    });
  },

  select: (id) => set({ selectedId: id }),

  remove: (id) => {
    const { shapes, selectedId } = get();
    set({
      shapes: shapes.filter((s) => s.id !== id),
      selectedId: selectedId === id ? null : selectedId,
    });
  },

  clearAll: () => set({ shapes: [], selectedId: null }),

  addCommitted: (shape) => {
    const committed = { ...shape, status: "committed" as const };
    set({ shapes: [...get().shapes, committed], selectedId: committed.id });
  },

  committed: () => get().shapes.filter((s) => s.status === "committed"),

  previews: () => get().shapes.filter((s) => s.status === "preview"),
}));
