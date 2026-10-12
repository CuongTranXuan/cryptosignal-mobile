import { describe, expect, it } from "vitest";
import type { CopilotModelRecord } from "../lib/copilot-schema";
import {
  UI_CANDLE_PRESETS,
  clampCandleCountForModel,
  recommendedMaxCandles,
} from "../lib/copilot-model-limits";

const model: CopilotModelRecord = {
  id: "agentrouter/deepseek-v4-flash",
  label: "deepseek-v4-flash",
  provider: "agentrouter",
  context_window: 1_000_000,
  max_output_tokens: 384_000,
  supports_reasoning: true,
  reasoning_efforts: ["low"],
  supports_json: true,
  recommended_max_candles: 500,
};

describe("copilot-model-limits", () => {
  it("uses server recommended_max_candles for clamping", () => {
    expect(recommendedMaxCandles(model)).toBe(500);
    expect(clampCandleCountForModel(999, model)).toBe(500);
    expect(clampCandleCountForModel(120, model, 80)).toBe(80);
  });

  it("exposes UI presets 50/100/200/300", () => {
    expect([...UI_CANDLE_PRESETS]).toEqual([50, 100, 200, 300]);
  });
});
