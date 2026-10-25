import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHART_THEME } from "../lib/chart-theme";
import { mapAgentMarkersToSeriesMarkers } from "../lib/marker-map";
import { AgentMarkerSchema, parseAgentMarker } from "../lib/pattern-shape";

const anchorFixture = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/wire/drawing-anchor-marker.json"), "utf8"),
);

describe("wire AgentMarker (C.13 drawing anchors)", () => {
  it("parses server anchor marker with drawing_id, Neo label, inBar circle", () => {
    const marker = parseAgentMarker(anchorFixture);
    expect(AgentMarkerSchema.safeParse(anchorFixture).success).toBe(true);
    expect(marker.drawing_id).toBe("drw_069d5f9c22e48577");
    expect(marker.label).toBe("Neo");
    expect(marker.position).toBe("inBar");
    expect(marker.side).toBe("neutral");
    expect(marker.shape).toBe("circle");
  });

  it("maps drawing anchors to muted neutral chart markers with label", () => {
    const series = mapAgentMarkersToSeriesMarkers([parseAgentMarker(anchorFixture)]);
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({
      id: "anchor-drw_069d5f9c22e48577",
      time: 1792598400,
      position: "inBar",
      shape: "circle",
      color: CHART_THEME.muted,
      text: "Neo",
    });
  });
});
