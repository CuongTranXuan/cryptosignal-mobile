import { create } from "zustand";
import type { AgentMarker } from "../pattern-shape";

type MarkerState = {
  markers: AgentMarker[];
  setMarkers: (markers: AgentMarker[]) => void;
  removeLinkedToDrawing: (drawingId: string) => void;
  clearAll: () => void;
};

export const useMarkerStore = create<MarkerState>((set, get) => ({
  markers: [],
  setMarkers: (markers) => set({ markers }),
  removeLinkedToDrawing: (drawingId) => {
    set({
      markers: get().markers.filter((m) => m.drawing_id !== drawingId),
    });
  },
  clearAll: () => set({ markers: [] }),
}));
