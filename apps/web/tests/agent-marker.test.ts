import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAgentMarker } from "../lib/pattern-shape";

const markerFixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../packages/schema/agent-marker.fixture.json"), "utf8"),
);

describe("AgentMarker", () => {
  it("parses the shared C.13 anchor fixture", () => {
    const marker = parseAgentMarker(markerFixture);
    expect(marker.side).toBe("neutral");
    expect(marker.position).toBe("inBar");
    expect(marker.shape).toBe("circle");
    expect(marker.label).toBe("Neo");
    expect(marker.drawing_id).toBe("drw_fixture");
    expect(marker.source).toBe("agent");
    expect(marker.agentId).toBeUndefined();
  });

  it("accepts optional agentId and wire side enum values", () => {
    const marker = parseAgentMarker({
      ...markerFixture,
      agentId: "agent-beta",
      label: "Neo",
    });
    expect(marker.agentId).toBe("agent-beta");
    expect(parseAgentMarker({ ...markerFixture, side: "buy" }).side).toBe("buy");
    expect(parseAgentMarker({ ...markerFixture, side: "sell" }).side).toBe("sell");
    expect(() => parseAgentMarker({ ...markerFixture, side: "BUY" })).toThrow();
  });

  it("rejects unknown keys and order-quantity fields", () => {
    expect(() => parseAgentMarker({ ...markerFixture, extra: true })).toThrow();
    expect(() => parseAgentMarker({ ...markerFixture, quantity: 1 })).toThrow();
    expect(() => parseAgentMarker({ ...markerFixture, apiKey: "x" })).toThrow();
  });
});
