import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CopilotSessionApiSchema,
  SessionMessageSchema,
} from "../lib/copilot-schema";
import {
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
} from "../lib/copilot-api";
import { apiSessionToClient } from "../lib/copilot-session-mapper";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import { resetCopilotModelsStoreForTests } from "../components/copilot/use-copilot-models";
import type { AgentMarker } from "../lib/pattern-shape";

const sampleMarker: AgentMarker = {
  id: "mk1",
  symbol: "BTCUSDT",
  interval: "1h",
  time: 1,
  side: "buy",
  position: "belowBar",
  shape: "arrowUp",
  confidence: 0.9,
  source: "agent",
};

describe("session reasoning_effort and markers", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
    resetCopilotModelsStoreForTests();
    clearCopilotModelsCache();
  });

  afterEach(() => {
    resetCopilotApiMockSessionsForTests();
  });

  it("parses old API payloads without reasoning_effort or markers", () => {
    const parsed = CopilotSessionApiSchema.parse({
      id: "s1",
      title: "Old",
      created_at: 1,
      updated_at: 2,
      model_id: "m",
      chart: {
        symbol: "BTCUSDT",
        interval: "1h",
        from: 0,
        to: 0,
        candle_count: 100,
      },
      messages: [
        {
          id: "u1",
          role: "user",
          content: "hi",
          model_id: null,
          shapes: [],
          created_at: 1,
        },
      ],
    });
    expect(parsed.reasoning_effort).toBeUndefined();
    expect(parsed.messages[0]?.markers ?? []).toEqual([]);
  });

  it("round-trips reasoning_effort and clears with null PATCH", async () => {
    const api = createCopilotApi({ forceMock: true });
    const created = await api.createSession({
      title: "R",
      model_id: "provider-a/model-alpha",
      reasoning_effort: "high",
      chart: {
        symbol: "BTCUSDT",
        interval: "1h",
        from: 0,
        to: 0,
        candle_count: 100,
      },
      messages: [],
    });
    expect(created.reasoning_effort).toBe("high");
    const cleared = await api.updateSession(created.id, { reasoning_effort: null });
    expect(cleared.reasoning_effort).toBeNull();
  });

  it("markers survive reload from server", async () => {
    const api = createCopilotApi({ forceMock: true });
    await loadCopilotModels(api);
    const msg = SessionMessageSchema.parse({
      id: "a1",
      role: "assistant",
      content: "done",
      model_id: "provider-a/model-alpha",
      shapes: [],
      markers: [sampleMarker],
      created_at: 3,
    });
    const created = await api.createSession({
      title: "Markers",
      model_id: "provider-a/model-alpha",
      reasoning_effort: "low",
      chart: {
        symbol: "BTCUSDT",
        interval: "1h",
        from: 0,
        to: 0,
        candle_count: 100,
      },
      messages: [msg],
    });
    localStorage.setItem("copilot.active_session_id", created.id);
    useCopilotSessionStore.getState().setApi(api);
    await useCopilotSessionStore.getState().bootstrap();
    expect(useMarkerStore.getState().markers).toHaveLength(1);
    const reloaded = await api.getSession(created.id);
    const client = apiSessionToClient(reloaded);
    expect(client.messages[0]?.markers).toHaveLength(1);
  });
});
