import { describe, expect, it } from "vitest";
import {
  formatInvalidationLine,
  labelForInvalidationCondition,
} from "../lib/guardrail-format";

describe("guardrail-format", () => {
  it("maps invalidation condition codes to Vietnamese", () => {
    expect(labelForInvalidationCondition("close_above")).toBe("Đóng nến trên");
    expect(labelForInvalidationCondition("close_below")).toBe("Đóng nến dưới");
    expect(labelForInvalidationCondition("custom_code")).toBe("custom code");
  });

  it("formats price and condition together", () => {
    expect(
      formatInvalidationLine(
        { price: 81056.36163113132, condition: "close_above" },
        "BTCUSDT",
      ),
    ).toBe("81,056.36 — Đóng nến trên");
  });
});
