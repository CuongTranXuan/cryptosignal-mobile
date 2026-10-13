import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  allowedUiReasoningLevels,
  defaultReasoningEffortForModel,
  modelShowsReasoningSelector,
  reasoningEffortForAnalyze,
  resetReasoningForModel,
} from "../lib/copilot-reasoning";
import type { CopilotModelRecord } from "../lib/copilot-schema";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import { createCopilotApi, resetCopilotApiMockSessionsForTests } from "../lib/copilot-api";

const reasoningModel: CopilotModelRecord = {
  id: "agentrouter/deepseek-v4-flash",
  label: "flash",
  provider: "agentrouter",
  context_window: 1_000_000,
  max_output_tokens: 384_000,
  supports_reasoning: true,
  reasoning_efforts: ["none", "low", "medium", "high"],
  supports_json: true,
};

const plainModel: CopilotModelRecord = {
  ...reasoningModel,
  id: "plain",
  supports_reasoning: false,
  reasoning_efforts: [],
};

const cursorNoneOnly: CopilotModelRecord = {
  ...reasoningModel,
  id: "cursor/auto",
  provider: "cursor",
  supports_reasoning: true,
  reasoning_efforts: ["none"],
};

describe("copilot-reasoning", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
    clearCopilotModelsCache();
  });

  afterEach(() => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
  });

  it("shows selector only when model exposes reasoning efforts", () => {
    expect(modelShowsReasoningSelector(reasoningModel)).toBe(true);
    expect(modelShowsReasoningSelector(plainModel)).toBe(false);
    expect(allowedUiReasoningLevels(reasoningModel)).toEqual(["off", "low", "medium", "high"]);
  });

  it("omits reasoning_effort for unsupported models", () => {
    expect(reasoningEffortForAnalyze(plainModel, "low")).toBeNull();
    expect(resetReasoningForModel(plainModel, "high")).toBeNull();
  });

  it("hides selector and omits reasoning_effort when only tier is none", () => {
    expect(modelShowsReasoningSelector(cursorNoneOnly)).toBe(false);
    expect(reasoningEffortForAnalyze(cursorNoneOnly, "none")).toBeNull();
    expect(defaultReasoningEffortForModel(cursorNoneOnly)).toBeNull();
  });

  it("persists reasoning_effort per session via API field", async () => {
    const api = createCopilotApi({ forceMock: true });
    await loadCopilotModels(api);
    const created = await api.createSession({
      title: "R",
      model_id: reasoningModel.id,
      reasoning_effort: "medium",
      chart: {
        symbol: "BTCUSDT",
        interval: "1h",
        from: 0,
        to: 0,
        candle_count: 100,
      },
      messages: [],
    });
    useCopilotSessionStore.getState().setApi(api);
    localStorage.setItem("copilot.active_session_id", created.id);
    await useCopilotSessionStore.getState().bootstrap();
    expect(useCopilotSessionStore.getState().reasoningEffort).toBe("medium");
    useCopilotSessionStore.getState().setReasoningEffort("high");
    await useCopilotSessionStore.getState().flushPersist();
    const reloaded = await api.getSession(created.id);
    expect(reloaded.reasoning_effort).toBe("high");
    expect(reloaded.title).toBe("R");
  });
});
