import { describe, expect, it } from "vitest";
import { mapCopilotErrorCode, mapCopilotSseErrorPayload } from "../lib/copilot-errors";
import {
  COPILOT_ERROR_EMPTY_OUTPUT,
  COPILOT_ERROR_INVALID_MODEL,
  COPILOT_ERROR_OVER_BUDGET,
  COPILOT_ERROR_INVALID_REASONING,
} from "../lib/copilot-strings";

describe("copilot-errors", () => {
  it("maps spec error codes to Vietnamese UI strings", () => {
    expect(mapCopilotErrorCode("unknown_model", "")).toBe(COPILOT_ERROR_INVALID_MODEL);
    expect(mapCopilotErrorCode("over_budget", "")).toBe(COPILOT_ERROR_OVER_BUDGET);
    expect(mapCopilotErrorCode("empty_model_output", "")).toBe(COPILOT_ERROR_EMPTY_OUTPUT);
    expect(mapCopilotErrorCode("invalid_reasoning_effort", "")).toBe(
      COPILOT_ERROR_INVALID_REASONING,
    );
  });

  it("parses SSE error payloads with code + message", () => {
    expect(
      mapCopilotSseErrorPayload({
        code: "empty_model_output",
        message: "Mô hình không trả lời",
      }),
    ).toBe(COPILOT_ERROR_EMPTY_OUTPUT);
  });
});
