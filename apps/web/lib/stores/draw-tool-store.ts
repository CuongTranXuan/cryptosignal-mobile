import { create } from "zustand";
import type { PatternShape } from "../pattern-shape";

export type DrawTool = "none" | "trendline" | "polyline" | "zone";

type Point = PatternShape["points"][number];

type DrawToolState = {
  tool: DrawTool;
  draftPoints: Point[];
  setTool: (tool: DrawTool) => void;
  addDraftPoint: (point: Point) => void;
  clearDraft: () => void;
  undoDraftPoint: () => void;
};

export const useDrawToolStore = create<DrawToolState>((set, get) => ({
  tool: "none",
  draftPoints: [],
  setTool: (tool) => set({ tool, draftPoints: [] }),
  addDraftPoint: (point) => set({ draftPoints: [...get().draftPoints, point] }),
  clearDraft: () => set({ draftPoints: [] }),
  undoDraftPoint: () => set({ draftPoints: get().draftPoints.slice(0, -1) }),
}));
