import { create } from "zustand";
import type { AgentMarker } from "../pattern-shape";

type MarkerState = {
  markers: AgentMarker[];
  setMarkers: (markers: AgentMarker[]) => void;
  clearAll: () => void;
};

export const useMarkerStore = create<MarkerState>((set) => ({
  markers: [],
  setMarkers: (markers) => set({ markers }),
  clearAll: () => set({ markers: [] }),
}));
