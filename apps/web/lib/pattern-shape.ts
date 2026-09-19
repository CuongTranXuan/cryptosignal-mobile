import { z } from "zod";

export const INTERVALS = ["1m", "15m", "1h", "4h", "1d"] as const;
export type Interval = (typeof INTERVALS)[number];

const PointSchema = z
  .object({
    time: z.number().int(),
    price: z.number(),
  })
  .strict();

export const PatternShapeSchema = z
  .object({
    id: z.string().min(1),
    agentId: z.string().min(1).optional(),
    symbol: z.string().min(1),
    interval: z.enum(INTERVALS),
    kind: z.enum(["trendline", "polyline", "zone"]),
    name: z.string().min(1),
    status: z.enum(["preview", "committed"]),
    source: z.literal("agent"),
    confidence: z.number().min(0).max(1),
    points: z.array(PointSchema),
    priceLow: z.number().nullable(),
    priceHigh: z.number().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "trendline" && value.points.length !== 2) {
      ctx.addIssue({ code: "custom", message: "trendline needs 2 points" });
    }
    if (value.kind === "polyline" && value.points.length < 3) {
      ctx.addIssue({ code: "custom", message: "polyline needs >= 3 points" });
    }
    if (value.kind === "zone") {
      if (value.priceLow == null || value.priceHigh == null || !(value.priceLow < value.priceHigh)) {
        ctx.addIssue({ code: "custom", message: "zone needs priceLow < priceHigh" });
      }
    }
  });

export type PatternShape = z.infer<typeof PatternShapeSchema>;
export const parsePatternShape = (input: unknown): PatternShape => PatternShapeSchema.parse(input);

/** Signal direction for series markers — not a trading order field. PatternShape still forbids `side`. */
export const AgentMarkerSchema = z
  .object({
    id: z.string().min(1),
    agentId: z.string().min(1).optional(),
    symbol: z.string().min(1),
    interval: z.enum(INTERVALS),
    time: z.number().int(),
    side: z.enum(["buy", "sell", "neutral"]),
    position: z.enum(["aboveBar", "belowBar", "inBar"]),
    shape: z.enum(["arrowUp", "arrowDown", "circle", "square"]),
    label: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
    source: z.literal("agent"),
  })
  .strict();
export type AgentMarker = z.infer<typeof AgentMarkerSchema>;
export const parseAgentMarker = (input: unknown): AgentMarker => AgentMarkerSchema.parse(input);

export const CandleSchema = z
  .object({
    time: z.number().int(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
  })
  .strict();
export type Candle = z.infer<typeof CandleSchema>;

export const AnalyzeRequestSchema = z
  .object({
    symbol: z.string(),
    interval: z.enum(INTERVALS),
    from: z.number().int(),
    to: z.number().int(),
    closedCandles: z.array(CandleSchema),
    existingShapes: z.array(PatternShapeSchema),
    existingMarkers: z.array(AgentMarkerSchema).optional(),
    prompt: z.string().min(1),
  })
  .strict();
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
