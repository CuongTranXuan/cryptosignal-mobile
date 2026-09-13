import { describe, expect, it } from "vitest";
import {
  HEAD_SHOULDERS_PROMPT,
  TRIANGLES_PROMPT,
} from "../lib/use-copilot";
import { isDrawDisabled, isSendDisabled } from "../lib/terminal-controls";

describe("terminal-controls", () => {
  it("exposes the locked preset prompts", () => {
    expect(TRIANGLES_PROMPT).toBe(
      "Find symmetrical triangles in this closed-candle window and return PatternShape polyline(s).",
    );
    expect(HEAD_SHOULDERS_PROMPT).toBe(
      "Find head and shoulders in this closed-candle window and return PatternShape polyline(s).",
    );
  });

  it("disables send when pair is unavailable or a request is in flight", () => {
    expect(isSendDisabled("pair-unavailable", false)).toBe(true);
    expect(isSendDisabled("live", true)).toBe(true);
    expect(isSendDisabled("live", false)).toBe(false);
    expect(isSendDisabled("reconnecting", false)).toBe(false);
    expect(isSendDisabled("history-error", false)).toBe(false);
  });

  it("disables draw when there are no preview shapes", () => {
    expect(isDrawDisabled(0)).toBe(true);
    expect(isDrawDisabled(2)).toBe(false);
  });
});
