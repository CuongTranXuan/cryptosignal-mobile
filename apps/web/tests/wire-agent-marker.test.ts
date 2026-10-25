import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isChartVisibleAgentMarker,
  mapAgentMarkersToSeriesMarkers,
} from "../lib/marker-map";
import { AgentMarkerSchema, parseAgentMarker } from "../lib/pattern-shape";

const anchorFixture = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/wire/drawing-anchor-marker.json"), "utf8"),
);

describe("wire AgentMarker (drawing anchors)", () => {
  it("parses server anchor marker with drawing_id and guardrail", () => {
    const marker = parseAgentMarker(anchorFixture);
    expect(AgentMarkerSchema.safeParse(anchorFixture).success).toBe(true);
    expect(marker.drawing_id).toBe("drw_abc123");
    expect(marker.guardrail?.regime).toBe("trend_up");
  });

  it("excludes drawing anchors from chart series markers", () => {
    expect(isChartVisibleAgentMarker(parseAgentMarker(anchorFixture))).toBe(false);
    const tradeMarker = parseAgentMarker({
      ...anchorFixture,
      id: "m1",
      drawing_id: undefined,
      guardrail: undefined,
      side: "buy",
      shape: "arrowUp",
      label: "Entry",
    });
    expect(isChartVisibleAgentMarker(tradeMarker)).toBe(true);
    const series = mapAgentMarkersToSeriesMarkers([
      parseAgentMarker(anchorFixture),
      tradeMarker,
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]?.id).toBe("m1");
  });
});
