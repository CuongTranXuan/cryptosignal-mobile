import { describe, expect, it } from "vitest";
import {
  HEAD_SHOULDERS_PROMPT,
  TRIANGLES_PROMPT,
} from "../lib/use-copilot";
import { feedBadgeLabel, isDrawDisabled, isSendDisabled } from "../lib/terminal-controls";

describe("terminal-controls", () => {
  it("exposes the locked preset prompts", () => {
    expect(TRIANGLES_PROMPT).toBe(
      "Tìm tam giác cân trong cửa sổ nến đã đóng này. Return PatternShape polyline(s). Reply and summarize in Vietnamese; output all text in Vietnamese.",
    );
    expect(HEAD_SHOULDERS_PROMPT).toBe(
      "Tìm mẫu vai đầu vai trong cửa sổ nến đã đóng này. Return PatternShape polyline(s). Reply and summarize in Vietnamese; output all text in Vietnamese.",
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

  it("maps feed connection to human badge copy", () => {
    expect(feedBadgeLabel("live")).toBe("Live");
    expect(feedBadgeLabel("reconnecting")).toBe("Reconnecting");
    expect(feedBadgeLabel("history-error")).toBe("History unavailable");
    expect(feedBadgeLabel("pair-unavailable")).toBe("Pair not available");
  });
});
