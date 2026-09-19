import { beforeEach, describe, expect, it } from "vitest";
import type { AgentMarker } from "../lib/pattern-shape";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useShapeStore } from "../lib/stores/shape-store";

const marker = (overrides: Partial<AgentMarker> = {}): AgentMarker => ({
  id: "m1",
  symbol: "BTCUSDT",
  interval: "1h",
  time: 1710000000,
  side: "buy",
  position: "belowBar",
  shape: "arrowUp",
  confidence: 0.7,
  source: "agent",
  ...overrides,
});

describe("useMarkerStore", () => {
  beforeEach(() => {
    useMarkerStore.setState({ markers: [] });
    useShapeStore.setState({ shapes: [], selectedId: null });
  });

  it("replaces the marker collection without touching PatternShape store", () => {
    useShapeStore.getState().setPreview([
      {
        id: "shape-1",
        symbol: "BTCUSDT",
        interval: "1h",
        kind: "trendline",
        name: "Line",
        status: "preview",
        source: "agent",
        confidence: 0.5,
        points: [
          { time: 1, price: 1 },
          { time: 2, price: 2 },
        ],
        priceLow: null,
        priceHigh: null,
      },
    ]);

    useMarkerStore.getState().setMarkers([marker({ id: "a" }), marker({ id: "b" })]);
    expect(useMarkerStore.getState().markers.map((m) => m.id)).toEqual(["a", "b"]);
    expect(useShapeStore.getState().shapes).toHaveLength(1);

    useMarkerStore.getState().setMarkers([marker({ id: "c" })]);
    expect(useMarkerStore.getState().markers.map((m) => m.id)).toEqual(["c"]);
    expect(useShapeStore.getState().shapes[0]?.id).toBe("shape-1");
  });

  it("clearAll empties markers only", () => {
    useMarkerStore.getState().setMarkers([marker()]);
    useShapeStore.getState().setPreview([
      {
        id: "shape-1",
        symbol: "BTCUSDT",
        interval: "1h",
        kind: "trendline",
        name: "Line",
        status: "preview",
        source: "agent",
        confidence: 0.5,
        points: [
          { time: 1, price: 1 },
          { time: 2, price: 2 },
        ],
        priceLow: null,
        priceHigh: null,
      },
    ]);

    useMarkerStore.getState().clearAll();
    expect(useMarkerStore.getState().markers).toEqual([]);
    expect(useShapeStore.getState().shapes).toHaveLength(1);
  });
});
