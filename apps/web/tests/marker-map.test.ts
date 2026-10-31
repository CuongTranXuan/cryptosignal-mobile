import { describe, expect, it } from "vitest";
import { CHART_THEME } from "../lib/chart-theme";
import { filterRenderableAnchorMarkers, mapAgentMarkersToSeriesMarkers } from "../lib/marker-map";
import type { AgentMarker } from "../lib/pattern-shape";

const anchor = (overrides: Partial<AgentMarker> = {}): AgentMarker => ({
  id: "anchor-drw_1",
  symbol: "BTCUSDT",
  interval: "1h",
  time: 1710000000,
  side: "neutral",
  position: "inBar",
  shape: "circle",
  label: "Neo",
  confidence: 0.7,
  source: "agent",
  drawing_id: "drw_1",
  ...overrides,
});

describe("marker-map", () => {
  it("keeps anchors only when linked drawing is on the chart", () => {
    const onChart = new Set(["drw_1", "drw_2"]);
    const filtered = filterRenderableAnchorMarkers(
      [
        anchor(),
        anchor({ id: "orphan", drawing_id: "drw_missing" }),
        anchor({ id: "free", drawing_id: undefined }),
      ],
      onChart,
    );
    expect(filtered.map((m) => m.id)).toEqual(["anchor-drw_1", "free"]);
  });

  it("maps C.13 anchors to muted neutral series markers", () => {
    const mapped = mapAgentMarkersToSeriesMarkers([
      anchor(),
      anchor({ id: "anchor-drw_2", label: undefined, drawing_id: "drw_2" }),
    ]);

    expect(mapped).toEqual([
      {
        id: "anchor-drw_1",
        time: 1710000000,
        position: "inBar",
        shape: "circle",
        color: CHART_THEME.muted,
        text: "Neo",
      },
      {
        id: "anchor-drw_2",
        time: 1710000000,
        position: "inBar",
        shape: "circle",
        color: CHART_THEME.muted,
      },
    ]);
  });
});
