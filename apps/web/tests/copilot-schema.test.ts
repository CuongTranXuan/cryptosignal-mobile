import { describe, expect, it } from "vitest";
import { isAdvancedRouteModel } from "../lib/copilot-schema";
import type { CopilotModelRecord } from "../lib/copilot-schema";

describe("copilot-schema", () => {
  it("flags combo/auto routes for advanced picker section", () => {
    const advanced: CopilotModelRecord = {
      id: "auto/combo-fast",
      label: "combo-fast",
      provider: "combo",
      context_window: 128_000,
      max_output_tokens: 8_192,
      supports_reasoning: true,
      reasoning_efforts: [],
      supports_json: true,
    };
    const normal: CopilotModelRecord = {
      ...advanced,
      id: "agentrouter/deepseek-v4-flash",
      provider: "agentrouter",
    };
    expect(isAdvancedRouteModel(advanced)).toBe(true);
    expect(isAdvancedRouteModel(normal)).toBe(false);
  });
});
