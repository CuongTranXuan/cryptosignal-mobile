import { describe, expect, it } from "vitest";
import {
  displayShapeName,
  formatBiasConflictBannerText,
} from "../lib/copilot-display";

describe("copilot-display", () => {
  it("maps detector shape names with the backend's Vietnamese table (vi_text._NAME_VI)", () => {
    expect(displayShapeName("Channel (low rail)")).toBe("Kênh giá (biên dưới)");
    expect(displayShapeName("Channel high rail")).toBe("Biên trên kênh giá");
    expect(displayShapeName("Double top")).toBe("Hai đỉnh");
    expect(displayShapeName("Support trendline")).toBe("Đường xu hướng hỗ trợ");
    expect(displayShapeName("Fib pocket 0.5–0.618")).toBe("Vùng Fibonacci 0.5–0.618");
  });

  it("keeps parameters (price, ratio, rail side) in parametric names", () => {
    expect(displayShapeName("S/R 67,250.5")).toBe("Vùng hỗ trợ/kháng cự 67,250.5");
    expect(displayShapeName("S/R support (flipped) 3,120")).toBe("Vùng hỗ trợ (đổi vai) 3,120");
    expect(displayShapeName("Fib 0.618")).toBe("Fibonacci 0.618");
    expect(displayShapeName("Ascending triangle upper")).toBe("Tam giác tăng (cạnh trên)");
  });

  it("falls back to pattern labels, and passes human names through", () => {
    expect(displayShapeName("Weird double bottom guess")).toBe("Đáy đôi");
    expect(displayShapeName("Đường của tôi")).toBe("Đường của tôi");
  });

  it("matches patterns-table name column labeling contract", () => {
    const tableLabel = (name: string) => displayShapeName(name);
    expect(tableLabel("Channel high rail")).not.toMatch(/Channel/i);
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
