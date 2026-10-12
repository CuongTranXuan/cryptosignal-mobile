import { describe, expect, it } from "vitest";
import {
  allowedUiReasoningLevels,
  modelShowsReasoningSelector,
  reasoningEffortForAnalyze,
  resetReasoningForModel,
} from "../lib/copilot-reasoning";
import type { CopilotModelRecord } from "../lib/copilot-schema";
import { SESSIONS_STORAGE_KEY, createEmptySession, loadSessionsBlob, saveSessionsBlob } from "../lib/copilot-sessions-v1";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import { createCopilotApi } from "../lib/copilot-api";

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

describe("copilot-reasoning", () => {
  it("shows selector only when model exposes reasoning efforts", () => {
    expect(modelShowsReasoningSelector(reasoningModel)).toBe(true);
    expect(modelShowsReasoningSelector(plainModel)).toBe(false);
    expect(allowedUiReasoningLevels(reasoningModel)).toEqual(["off", "low", "medium", "high"]);
  });

  it("omits reasoning_effort for unsupported models", () => {
    expect(reasoningEffortForAnalyze(plainModel, "low")).toBeNull();
    expect(resetReasoningForModel(plainModel, "high")).toBeNull();
  });

  it("persists reasoning_effort per session in localStorage", async () => {
    localStorage.removeItem(SESSIONS_STORAGE_KEY);
    clearCopilotModelsCache();
    await loadCopilotModels(createCopilotApi({ forceMock: true }));
    const session = createEmptySession(reasoningModel.id, "R", "medium");
    saveSessionsBlob({ active_session_id: session.id, sessions: [session] });
    useCopilotSessionStore.setState({
      activeSessionId: session.id,
      modelId: reasoningModel.id,
      reasoningEffort: "medium",
      candleCount: 100,
    });
    useCopilotSessionStore.getState().persistActiveSession();
    const blob = loadSessionsBlob();
    expect(blob.sessions[0]?.reasoning_effort).toBe("medium");
  });
});
