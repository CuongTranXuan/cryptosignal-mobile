import { describe, expect, it } from "vitest";

import { chartAnnotationPayloadSchema, parseChartAnnotationPayload } from "../server/chart-annotations";

const sampleHorizontal = {
  id: "annotation-sample-01",
  kind: "HORIZONTAL_LEVEL" as const,
  assetSymbol: "BTC/USDT",
  timeframe: "1h",
  createdAt: "2026-08-18T10:00:00.000Z",
  dataQuality: "CLOSED_CANDLE" as const,
  source: "ENGINE" as const,
  label: "SMC break",
  price: 64000,
};

const sampleOverlay = {
  id: "annotation-sample-02",
  kind: "METHODOLOGY_OVERLAY" as const,
  assetSymbol: "BTC/USDT",
  timeframe: "1h",
  createdAt: "2026-08-18T10:00:00.000Z",
  dataQuality: "CLOSED_CANDLE" as const,
  source: "ENGINE" as const,
  ruleId: "SMC_BULLISH_BOS_PROXY_V1",
  ruleFamily: "SMC",
  direction: "BULLISH" as const,
  sourceFindingId: "public-1-SMC_BULLISH_BOS_PROXY_V1",
  overlayShape: "HORIZONTAL_LEVEL" as const,
  geometry: sampleHorizontal,
};

describe("chart annotation payload contract", () => {
  it("round-trips a horizontal level through the zod schema", () => {
    const parsed = chartAnnotationPayloadSchema.parse(sampleHorizontal);
    expect(parsed).toEqual(sampleHorizontal);
    expect(parseChartAnnotationPayload(sampleHorizontal)).toEqual(sampleHorizontal);
  });

  it("round-trips a methodology overlay through the zod schema", () => {
    const parsed = chartAnnotationPayloadSchema.parse(sampleOverlay);
    expect(parsed).toEqual(sampleOverlay);
    expect(parseChartAnnotationPayload(sampleOverlay)).toEqual(sampleOverlay);
  });
});
