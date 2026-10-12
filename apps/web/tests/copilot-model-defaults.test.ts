import { describe, expect, it } from "vitest";
import {
  PREFERRED_DEFAULT_MODEL_ID,
  modelIdForAnalyzeRequest,
  resolveDefaultModelId,
  resolveSessionModelId,
} from "../lib/copilot-model-defaults";
import type { CopilotModelRecord } from "../lib/copilot-schema";
import { DEFAULT_CANDLE_COUNT } from "../lib/copilot-model-limits";

const flash: CopilotModelRecord = {
  id: "agentrouter/deepseek-v4-flash",
  label: "flash",
  provider: "agentrouter",
  context_window: 1_000_000,
  max_output_tokens: 384_000,
  supports_reasoning: true,
  reasoning_efforts: ["none", "low"],
  supports_json: true,
};

const other: CopilotModelRecord = {
  ...flash,
  id: "other/model",
  label: "other",
};

describe("resolveDefaultModelId", () => {
  it("prefers saved id when still in list", () => {
    expect(resolveDefaultModelId([flash, other], flash.id, other.id)).toBe(flash.id);
  });

  it("falls back to deepseek-v4-flash when saved id is missing", () => {
    expect(resolveDefaultModelId([flash, other], "gone", other.id)).toBe(
      PREFERRED_DEFAULT_MODEL_ID,
    );
  });

  it("falls back to API default then first model", () => {
    expect(resolveDefaultModelId([other], null, other.id)).toBe(other.id);
    expect(resolveDefaultModelId([other], null, "missing")).toBe(other.id);
    expect(resolveDefaultModelId([], null, null)).toBeNull();
  });

  it("resolveSessionModelId never returns empty when catalog is empty", () => {
    expect(resolveSessionModelId([], "", null)).toBe(PREFERRED_DEFAULT_MODEL_ID);
    expect(modelIdForAnalyzeRequest([], "", null)).toBeUndefined();
  });
});

describe("default candle count", () => {
  it("is 100", () => {
    expect(DEFAULT_CANDLE_COUNT).toBe(100);
  });
});
