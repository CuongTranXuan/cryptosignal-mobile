import { z } from "zod";

import type { ChartAnnotation, ChartAnnotationSource } from "../shared/chart-types";

const chartAnnotationBaseSchema = z.object({
  id: z.string().min(8).max(64),
  assetSymbol: z.string().min(3).max(32),
  timeframe: z.string().min(1).max(12),
  createdAt: z.string().datetime(),
  dataQuality: z.enum(["CLOSED_CANDLE", "LIVE_UNCONFIRMED"]),
  source: z.enum(["ENGINE", "AGENT", "DASHBOARD", "SYSTEM"]).optional(),
  label: z.string().max(120).optional(),
});

export const chartAnnotationPayloadSchema = z.discriminatedUnion("kind", [
  chartAnnotationBaseSchema.extend({
    kind: z.literal("HORIZONTAL_LEVEL"),
    price: z.number(),
  }),
  chartAnnotationBaseSchema.extend({
    kind: z.literal("TRENDLINE"),
    startTime: z.string().datetime(),
    startPrice: z.number(),
    endTime: z.string().datetime(),
    endPrice: z.number(),
  }),
  chartAnnotationBaseSchema.extend({
    kind: z.literal("ZONE"),
    topPrice: z.number(),
    bottomPrice: z.number(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
  }),
  chartAnnotationBaseSchema.extend({
    kind: z.literal("METHODOLOGY_OVERLAY"),
    source: z.enum(["ENGINE", "AGENT", "DASHBOARD", "SYSTEM"]),
    ruleId: z.string().min(1).max(64),
    ruleFamily: z.string().min(1).max(32),
    direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
    sourceFindingId: z.string().min(1).max(96),
    overlayShape: z.enum(["HORIZONTAL_LEVEL", "TRENDLINE", "ZONE"]),
    geometry: z.union([
      chartAnnotationBaseSchema.extend({ kind: z.literal("HORIZONTAL_LEVEL"), price: z.number() }),
      chartAnnotationBaseSchema.extend({
        kind: z.literal("TRENDLINE"),
        startTime: z.string().datetime(),
        startPrice: z.number(),
        endTime: z.string().datetime(),
        endPrice: z.number(),
      }),
      chartAnnotationBaseSchema.extend({
        kind: z.literal("ZONE"),
        topPrice: z.number(),
        bottomPrice: z.number(),
        startTime: z.string().datetime(),
        endTime: z.string().datetime(),
      }),
    ]),
  }),
]);

export function resolveAnnotationSource(annotation: ChartAnnotation): ChartAnnotationSource {
  if (annotation.kind === "METHODOLOGY_OVERLAY") return annotation.source;
  return annotation.source ?? "ENGINE";
}

export function parseChartAnnotationPayload(payload: unknown): ChartAnnotation {
  return chartAnnotationPayloadSchema.parse(payload);
}
