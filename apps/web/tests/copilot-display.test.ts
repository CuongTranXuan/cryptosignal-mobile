import { describe, expect, it } from "vitest";
import {
  displayShapeName,
  formatBiasConflictBannerText,
} from "../lib/copilot-display";

describe("copilot-display", () => {
  it("maps English backend shape names to Vietnamese pattern labels", () => {
    expect(displayShapeName("Channel (low rail)")).toBe("Kênh giảm");
    expect(displayShapeName("Double top")).toBe("Đỉnh đôi");
  });

  it("builds Vietnamese bias conflict banner from regime and user bias", () => {
    const text = formatBiasConflictBannerText(
      { detected_regime: "trend_up", bias_conflict: true },
      "bearish",
    );
    expect(text).toContain("Giảm");
    expect(text).toContain("Xu hướng tăng");
    expect(text).not.toContain("User bias conflicts");
  });
});
