import { describe, expect, it } from "vitest";
import { mapAgentMarkersToSeriesMarkers } from "../lib/marker-map";
import type { AgentMarker } from "../lib/pattern-shape";

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

describe("marker-map", () => {
  it("maps AgentMarker fields onto LWC series markers", () => {
    const mapped = mapAgentMarkersToSeriesMarkers([
      marker({ id: "buy-1", label: "long" }),
      marker({
        id: "sell-1",
        side: "sell",
        position: "aboveBar",
        shape: "arrowDown",
      }),
      marker({
        id: "flat-1",
        side: "neutral",
        position: "inBar",
        shape: "circle",
      }),
    ]);

    expect(mapped).toEqual([
      {
        id: "buy-1",
        time: 1710000000,
        position: "belowBar",
        shape: "arrowUp",
        color: "#0ecb81",
        text: "long",
      },
      {
        id: "sell-1",
        time: 1710000000,
        position: "aboveBar",
        shape: "arrowDown",
        color: "#f6465d",
      },
      {
        id: "flat-1",
        time: 1710000000,
        position: "inBar",
        shape: "circle",
        color: "#f0b90b",
      },
    ]);
  });
});
