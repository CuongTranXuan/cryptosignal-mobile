import { describe, expect, it } from "vitest";

import { buildAnnotationsFromSignalContext, createAnnotationId } from "../shared/annotation-generator";

const baseInput = {
  assetSymbol: "BTC/USDT",
  timeframe: "1h",
  candleCloseTime: "2026-08-18T10:00:00.000Z",
  configVersion: 3,
  invalidation: { researchOnly: true, close: 64500, atr14: 700 },
  candle: { close: 64500, low: 63800, high: 65100, ema20: 64200, ema50: 63800 },
  researchWindowStartTime: "2026-08-17T06:00:00.000Z",
};

describe("annotation generator", () => {
  it("creates deterministic ids from stable parts", () => {
    const left = createAnnotationId(["BTC/USDT", "1h", "2026-08-18T10:00:00.000Z", "SMC_BULLISH_BOS_PROXY_V1", "HORIZONTAL_LEVEL"]);
    const right = createAnnotationId(["BTC/USDT", "1h", "2026-08-18T10:00:00.000Z", "SMC_BULLISH_BOS_PROXY_V1", "HORIZONTAL_LEVEL"]);
    expect(left).toBe(right);
    expect(left.startsWith("annotation-")).toBe(true);
  });

  it("maps Wyckoff spring finding to support level and sweep zone", () => {
    const annotations = buildAnnotationsFromSignalContext({
      ...baseInput,
      findings: [{
        findingId: "public-1-WYCKOFF_SPRING_PROXY_V1",
        ruleFamily: "WYCKOFF",
        ruleId: "WYCKOFF_SPRING_PROXY_V1",
        direction: "BULLISH",
        strength: 0.16,
        evidence: { priorLow: 63000, close: 64500, closedCandle: true },
      }],
    });
    expect(annotations.some((a) => a.kind === "METHODOLOGY_OVERLAY" && a.overlayShape === "HORIZONTAL_LEVEL")).toBe(true);
    expect(annotations.some((a) => a.kind === "METHODOLOGY_OVERLAY" && a.overlayShape === "ZONE")).toBe(true);
  });

  it("maps SMC bullish BOS to horizontal break level", () => {
    const annotations = buildAnnotationsFromSignalContext({
      ...baseInput,
      findings: [{
        findingId: "public-1-SMC_BULLISH_BOS_PROXY_V1",
        ruleFamily: "SMC",
        ruleId: "SMC_BULLISH_BOS_PROXY_V1",
        direction: "BULLISH",
        strength: 0.18,
        evidence: { priorHigh: 64000, close: 64500, closedCandle: true },
      }],
    });
    const level = annotations.find((a) => a.kind === "METHODOLOGY_OVERLAY" && a.ruleId === "SMC_BULLISH_BOS_PROXY_V1");
    expect(level?.kind === "METHODOLOGY_OVERLAY" ? level.overlayShape : null).toBe("HORIZONTAL_LEVEL");
    if (level?.kind === "METHODOLOGY_OVERLAY" && level.geometry.kind === "HORIZONTAL_LEVEL") {
      expect(level.geometry.price).toBe(64000);
    }
  });

  it("adds invalidation zone from snapshot close and atr14", () => {
    const annotations = buildAnnotationsFromSignalContext({ ...baseInput, findings: [] });
    const invalidation = annotations.find((a) => a.kind === "ZONE" && a.label === "INVALIDATION");
    expect(invalidation).toBeDefined();
    if (invalidation?.kind === "ZONE") {
      expect(invalidation.topPrice).toBe(65200);
      expect(invalidation.bottomPrice).toBe(63800);
    }
  });

  it("ignores candle-pattern findings", () => {
    const annotations = buildAnnotationsFromSignalContext({
      ...baseInput,
      findings: [{
        findingId: "public-1-DOJI_V1",
        ruleFamily: "CANDLE_PATTERN",
        ruleId: "DOJI_V1",
        direction: "NEUTRAL",
        strength: 0.05,
        evidence: { closedCandle: true },
      }],
    });
    expect(annotations.some((a) => a.kind === "METHODOLOGY_OVERLAY" && a.ruleId === "DOJI_V1")).toBe(false);
    expect(annotations.some((a) => a.kind === "ZONE" && a.label === "INVALIDATION")).toBe(true);
  });
});
