import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAgentMarker } from "../lib/pattern-shape";

const markerFixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../packages/schema/agent-marker.fixture.json"), "utf8"),
);

describe("AgentMarker", () => {
  it("parses the shared fixture", () => {
    const marker = parseAgentMarker(markerFixture);
    expect(marker.side).toBe("buy");
    expect(marker.position).toBe("belowBar");
    expect(marker.shape).toBe("arrowUp");
    expect(marker.source).toBe("agent");
    expect(marker.agentId).toBeUndefined();
  });

  it("accepts optional agentId and label", () => {
    const marker = parseAgentMarker({
      ...markerFixture,
      agentId: "agent-beta",
      label: "sweep",
    });
    expect(marker.agentId).toBe("agent-beta");
    expect(marker.label).toBe("sweep");
  });

  it("accepts signal-direction side only", () => {
    expect(parseAgentMarker({ ...markerFixture, side: "sell" }).side).toBe("sell");
    expect(parseAgentMarker({ ...markerFixture, side: "neutral" }).side).toBe("neutral");
    expect(() => parseAgentMarker({ ...markerFixture, side: "BUY" })).toThrow();
  });

  it("rejects unknown keys and order-quantity fields", () => {
    expect(() => parseAgentMarker({ ...markerFixture, extra: true })).toThrow();
    expect(() => parseAgentMarker({ ...markerFixture, quantity: 1 })).toThrow();
    expect(() => parseAgentMarker({ ...markerFixture, apiKey: "x" })).toThrow();
  });
});
