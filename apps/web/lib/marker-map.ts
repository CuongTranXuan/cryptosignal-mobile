import { CHART_THEME } from "./chart-theme";
import type { AgentMarker } from "./pattern-shape";

export type SeriesMarkerLike = {
  id: string;
  time: number;
  position: AgentMarker["position"];
  shape: AgentMarker["shape"];
  color: string;
  text?: string;
};

function colorForSide(side: AgentMarker["side"]): string {
  switch (side) {
    case "buy":
      return CHART_THEME.green;
    case "sell":
      return CHART_THEME.red;
    case "neutral":
      return CHART_THEME.gold;
    default: {
      const _exhaustive: never = side;
      return _exhaustive;
    }
  }
}

/** Server drawing anchors carry `drawing_id` and are not chart trade markers (C.12). */
export function isChartVisibleAgentMarker(marker: AgentMarker): boolean {
  return marker.drawing_id == null || marker.drawing_id === "";
}

export function mapAgentMarkersToSeriesMarkers(markers: AgentMarker[]): SeriesMarkerLike[] {
  return markers.filter(isChartVisibleAgentMarker).map((marker) => {
    const mapped: SeriesMarkerLike = {
      id: marker.id,
      time: marker.time,
      position: marker.position,
      shape: marker.shape,
      color: colorForSide(marker.side),
    };
    if (marker.label) mapped.text = marker.label;
    return mapped;
  });
}
