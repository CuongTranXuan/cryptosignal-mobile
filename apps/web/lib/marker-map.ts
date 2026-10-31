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

/** C.13: server anchors only — muted neutral circles, no buy/sell semantics. */
const NEUTRAL_MARKER_COLOR = CHART_THEME.muted;

/** Anchors linked to a drawing render only when that shape is on the chart. */
export function filterRenderableAnchorMarkers(
  markers: AgentMarker[],
  shapeIdsOnChart: ReadonlySet<string>,
): AgentMarker[] {
  return markers.filter((marker) => !marker.drawing_id || shapeIdsOnChart.has(marker.drawing_id));
}

export function mapAgentMarkersToSeriesMarkers(markers: AgentMarker[]): SeriesMarkerLike[] {
  return markers.map((marker) => {
    const mapped: SeriesMarkerLike = {
      id: marker.id,
      time: marker.time,
      position: marker.position,
      shape: marker.shape,
      color: NEUTRAL_MARKER_COLOR,
    };
    if (marker.label) mapped.text = marker.label;
    return mapped;
  });
}
