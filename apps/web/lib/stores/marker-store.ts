import { create } from "zustand";
import type { AgentMarker } from "../pattern-shape";

function uniqueMarkersById(markers: AgentMarker[]): AgentMarker[] {
  const seen = new Set<string>();
  return markers.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

function withoutOrphans(
  markers: AgentMarker[],
  drawingIdsOnChart: ReadonlySet<string>,
): AgentMarker[] {
  return markers.filter((m) => !m.drawing_id || drawingIdsOnChart.has(m.drawing_id));
}

type MarkerState = {
  markers: AgentMarker[];
  setMarkers: (markers: AgentMarker[]) => void;
  /**
   * Run markers replace earlier ones with the same id or drawing_id; anchors of other
   * drawings still on the chart stay, orphans (drawing gone) are dropped.
   */
  mergeRunMarkers: (markers: AgentMarker[], drawingIdsOnChart: ReadonlySet<string>) => void;
  /** Drop anchors whose drawing is no longer on the chart. */
  pruneOrphans: (drawingIdsOnChart: ReadonlySet<string>) => void;
  removeLinkedToDrawing: (drawingId: string) => void;
  clearAll: () => void;
};

export const useMarkerStore = create<MarkerState>((set, get) => ({
  markers: [],
  setMarkers: (markers) => set({ markers: uniqueMarkersById(markers) }),
  mergeRunMarkers: (markers, drawingIdsOnChart) => {
    const incoming = uniqueMarkersById(markers);
    const ids = new Set(incoming.map((m) => m.id));
    const drawingIds = new Set(incoming.flatMap((m) => (m.drawing_id ? [m.drawing_id] : [])));
    const carried = get().markers.filter(
      (m) => !ids.has(m.id) && !(m.drawing_id && drawingIds.has(m.drawing_id)),
    );
    set({ markers: withoutOrphans([...carried, ...incoming], drawingIdsOnChart) });
  },
  pruneOrphans: (drawingIdsOnChart) => {
    const next = withoutOrphans(get().markers, drawingIdsOnChart);
    if (next.length !== get().markers.length) set({ markers: next });
  },
  removeLinkedToDrawing: (drawingId) => {
    set({
      markers: get().markers.filter((m) => m.drawing_id !== drawingId),
    });
  },
  clearAll: () => set({ markers: [] }),
}));
