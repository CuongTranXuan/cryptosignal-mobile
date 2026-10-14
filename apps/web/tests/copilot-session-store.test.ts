import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
} from "../lib/copilot-api";
import { loadActiveSessionId } from "../lib/copilot-active-session-cache";
import { agentMessageModelLabel } from "../lib/copilot-session-mapper";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { resetCopilotModelsStoreForTests } from "../components/copilot/use-copilot-models";

describe("copilot session store (API)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
    resetCopilotModelsStoreForTests();
    clearCopilotModelsCache();
    useAiStore.setState({ messages: [], inFlight: false, lastError: null });
    useChartStore.setState({ symbol: "BTCUSDT", interval: "1h" });
    useCopilotSessionStore.setState({
      api: null,
      sessions: [],
      activeSessionId: null,
      sessionCache: {},
      sessionsError: null,
      sessionsDirty: false,
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
  });

  it("restores reasoning, chart, messages, and model_id from server", async () => {
    const api = createCopilotApi({ forceMock: true });
    await loadCopilotModels(api);
    const created = await api.createSession({
      title: "Phiên A",
      model_id: "provider-a/model-alpha",
      reasoning_effort: "low",
      chart: {
        symbol: "SOLUSDT",
        interval: "15m",
        from: 5,
        to: 9,
        candle_count: 200,
      },
      messages: [
        {
          id: "u1",
          role: "user",
          content: "q",
          model_id: null,
          shapes: [],
          markers: [],
          created_at: 2,
        },
        {
          id: "a1",
          role: "assistant",
          content: "a",
          model_id: "provider-a/model-alpha",
          shapes: [],
          markers: [],
          created_at: 3,
        },
      ],
    });
    localStorage.setItem("copilot.active_session_id", created.id);
    useCopilotSessionStore.getState().setApi(api);
    await useCopilotSessionStore.getState().bootstrap();

    const state = useCopilotSessionStore.getState();
    expect(state.reasoningEffort).toBe("low");
    expect(state.candleCount).toBe(200);
    expect(useChartStore.getState().symbol).toBe("SOLUSDT");
    expect(useAiStore.getState().messages).toHaveLength(2);
    expect(loadActiveSessionId()).toBe(created.id);
  });

  it("formats agent message label with provider", async () => {
    const api = createCopilotApi({ forceMock: true });
    const models = (await loadCopilotModels(api)).models;
    const label = agentMessageModelLabel(
      models,
      "provider-a/model-alpha",
      models[0]?.id,
    );
    expect(label).toBe("provider-a · model-alpha");
  });
});
