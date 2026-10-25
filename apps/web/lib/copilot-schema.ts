import { z } from "zod";
import type { AgentMarker, Interval, PatternShape } from "./pattern-shape";

/** Zod schemas aligned with `docs/MODEL_SELECTION_SPEC.md` (client-facing subset). */

export const CopilotModelRecordSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  context_window: z.number(),
  max_output_tokens: z.number(),
  supports_reasoning: z.boolean(),
  reasoning_efforts: z.array(z.string()).optional().default([]),
  supports_json: z.boolean().optional().default(true),
  source: z.enum(["provider", "table", "default"]).optional(),
  request_max_tokens: z.number().optional(),
  recommended_candles: z.number().optional(),
  recommended_max_candles: z.number().optional(),
  presets: z.array(z.number()).optional(),
});

export const ModelsListResponseSchema = z.object({
  default_model: z.string(),
  fetched_at: z.number(),
  models: z.array(CopilotModelRecordSchema),
});

export type CopilotModelRecord = z.infer<typeof CopilotModelRecordSchema>;
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;

export const ChartStyleIdSchema = z.enum(["classic", "smc", "elliott", "wyckoff"]);
export type ChartStyleId = z.infer<typeof ChartStyleIdSchema>;

export const ChartBiasSchema = z.enum(["bullish", "bearish", "neutral"]);
export type ChartBias = z.infer<typeof ChartBiasSchema>;

const optionalBias = z
  .union([ChartBiasSchema, z.null()])
  .optional()
  .transform((value) => (value == null ? undefined : value));

const optionalPatternId = z
  .union([z.string().min(1), z.null()])
  .optional()
  .transform((value) => (value == null ? undefined : value));

export const ChartHorizonSchema = z.enum(["scalp", "swing", "position"]);
export type ChartHorizon = z.infer<typeof ChartHorizonSchema>;

const optionalHorizon = z
  .union([ChartHorizonSchema, z.null()])
  .optional()
  .transform((value) => (value == null ? undefined : value));

export const AnalyzeIntentSchema = z.object({
  style: ChartStyleIdSchema.default("classic"),
  bias: optionalBias,
  requested_pattern: optionalPatternId,
  horizon: optionalHorizon,
});

export type AnalyzeIntent = z.infer<typeof AnalyzeIntentSchema>;

export const DrawingRegimeSchema = z.enum(["trend_up", "trend_down", "range", "volatile"]);
export type DrawingRegime = z.infer<typeof DrawingRegimeSchema>;

export const DrawingInvalidationSchema = z.object({
  price: z.number(),
  condition: z.string().optional(),
});

export const DrawingGuardrailSchema = z.object({
  regime: DrawingRegimeSchema,
  confidence: z.number().min(0).max(1),
  evidence_against: z.array(z.string()),
  invalidation: DrawingInvalidationSchema.nullable(),
});

export type DrawingGuardrail = z.infer<typeof DrawingGuardrailSchema>;

export const IntentCheckSchema = z.object({
  detected_regime: DrawingRegimeSchema,
  bias_conflict: z.boolean(),
  message: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => (value == null ? undefined : value)),
});

export type IntentCheck = z.infer<typeof IntentCheckSchema>;

export const KnownSkippedReasonCodeSchema = z.enum([
  "low_confidence",
  "out_of_window",
  "invalid_geometry",
  "no_candidate",
  "unsupported_pattern",
  "cap",
]);

export type KnownSkippedReasonCode = z.infer<typeof KnownSkippedReasonCodeSchema>;

/** Wire `reason_code` — unknown codes are kept for display, not rejected. */
export const SkippedReasonCodeSchema = z.string().min(1);

export type SkippedReasonCode = string;

export const SkippedEntrySchema = z.object({
  reason_code: SkippedReasonCodeSchema,
  count: z.number().int().nonnegative(),
});

export type SkippedEntry = z.infer<typeof SkippedEntrySchema>;

export const IntentSourceSchema = z.enum(["rules", "llm"]);

export const AnalyzeMetaEventSchema = z.object({
  model: z.string(),
  candle_count_requested: z
    .union([z.number(), z.null()])
    .optional()
    .transform((value) => (value == null ? 0 : value)),
  candle_count_used: z.number(),
  clamped: z.boolean(),
  max_tokens: z.number().optional(),
  reasoning_effort: z.string().nullable().optional(),
  retried: z.boolean().optional(),
  intent: AnalyzeIntentSchema.optional(),
  intent_check: IntentCheckSchema.optional(),
  intent_source: IntentSourceSchema.optional(),
  feature_sheet: z.record(z.unknown()).optional(),
  candidates: z.array(z.unknown()).optional(),
  prompt_candle_reduction_pct: z.number().optional(),
  preview_shape_budget: z.number().int().positive().optional(),
  intent_budget_fallback: z.boolean().optional(),
  htf: z
    .object({
      interval: z.string().optional(),
      regime: DrawingRegimeSchema.optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  horizon: ChartHorizonSchema.nullable().optional(),
  skipped: z.array(SkippedEntrySchema).optional(),
  skipped_count: z.number().int().nonnegative().optional(),
});

export type AnalyzeMetaEvent = z.infer<typeof AnalyzeMetaEventSchema>;

const RegimeSseEventCoreSchema = z.object({
  regime: DrawingRegimeSchema.optional(),
  intent_check: IntentCheckSchema.optional(),
  ltf: z
    .object({
      regime: DrawingRegimeSchema.optional(),
      strength: z.number().optional(),
    })
    .optional(),
});

export const RegimeSseEventSchema = RegimeSseEventCoreSchema.transform((data) => {
  const regime = data.regime ?? data.ltf?.regime ?? "range";
  return { regime, intent_check: data.intent_check };
});

export type RegimeSseEvent = z.infer<typeof RegimeSseEventSchema>;

const optionalBiasWire = z
  .union([ChartBiasSchema, z.null()])
  .optional()
  .transform((value) => (value == null ? undefined : value));

export const AnalysisSseEventSchema = z
  .object({
    bias: optionalBiasWire,
    no_valid_pattern: z.boolean().optional(),
    evidence_for: z.array(z.string()).optional().default([]),
    evidence_against: z.array(z.string()).optional().default([]),
    invalidation: DrawingInvalidationSchema.nullable().optional(),
    confidence: z.number().nullable().optional(),
    intent_check: IntentCheckSchema.optional(),
  })
  .passthrough();

export type AnalysisSseEvent = z.infer<typeof AnalysisSseEventSchema>;

export const StylePatternRefSchema = z.object({
  id: z.string().min(1),
});

export const StyleCatalogEntrySchema = z.object({
  id: z.string().min(1),
  patterns: z.array(StylePatternRefSchema),
});

export const StylesListResponseSchema = z.object({
  styles: z.array(StyleCatalogEntrySchema),
});

export type StylesListResponse = z.infer<typeof StylesListResponseSchema>;

export const FeedbackActionSchema = z.enum(["keep", "reject", "edit", "delete"]);
export type FeedbackAction = z.infer<typeof FeedbackActionSchema>;

export const FeedbackRequestSchema = z.object({
  session_id: z.string().min(1),
  message_id: z.string().optional(),
  drawing_id: z.string().min(1),
  action: FeedbackActionSchema,
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  client_ts: z.number().optional(),
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const FeedbackResponseSchema = z.object({
  id: z.string().min(1),
});

export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;

export const CopilotErrorEventSchema = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.unknown().optional(),
});

export type CopilotErrorEvent = z.infer<typeof CopilotErrorEventSchema>;

export const SessionChartSchema = z.object({
  symbol: z.string(),
  interval: z.string(),
  from: z.number(),
  to: z.number(),
  candle_count: z.number(),
});

export const SessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  model_id: z.string().nullable(),
  shapes: z.array(z.unknown()),
  created_at: z.number(),
  meta: z
    .object({
      candle_count_used: z.number(),
      clamped: z.boolean(),
    })
    .optional(),
  markers: z.array(z.unknown()).optional(),
});

export const CopilotSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  model_id: z.string(),
  reasoning_effort: z.string().nullable().optional(),
  intent: AnalyzeIntentSchema.nullable().optional(),
  chart: SessionChartSchema,
  messages: z.array(SessionMessageSchema),
});

export type CopilotSessionV1 = z.infer<typeof CopilotSessionSchema>;

/** Backend `SessionSummary` (list endpoint). */
export const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  model_id: z.string(),
  reasoning_effort: z.string().nullable().optional(),
  intent: AnalyzeIntentSchema.nullable().optional(),
  symbol: z.string(),
  interval: z.string(),
  candle_count: z.number(),
  message_count: z.number(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionsListResponseSchema = z.object({
  sessions: z.array(SessionSummarySchema),
});

/** Backend `CopilotSession` document. */
export const CopilotSessionApiSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  model_id: z.string(),
  reasoning_effort: z.string().nullable().optional(),
  intent: AnalyzeIntentSchema.nullable().optional(),
  chart: SessionChartSchema,
  messages: z.array(SessionMessageSchema),
});

export type CopilotSessionApi = z.infer<typeof CopilotSessionApiSchema>;

export const CreateSessionRequestSchema = z.object({
  title: z.string(),
  model_id: z.string(),
  reasoning_effort: z.string().nullable().optional(),
  intent: AnalyzeIntentSchema.nullable().optional(),
  chart: SessionChartSchema,
  messages: z.array(SessionMessageSchema).optional(),
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const UpdateSessionRequestSchema = z.object({
  title: z.string().optional(),
  model_id: z.string().optional(),
  reasoning_effort: z.string().nullable().optional(),
  intent: AnalyzeIntentSchema.nullable().optional(),
  chart: SessionChartSchema.optional(),
  messages: z.array(SessionMessageSchema).optional(),
});

export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequestSchema>;

export type CopilotProviderGroup = {
  id: string;
  label: string;
  models: CopilotModelRecord[];
};

export function groupModelsByProvider(models: CopilotModelRecord[]): CopilotProviderGroup[] {
  const map = new Map<string, CopilotModelRecord[]>();
  for (const model of models) {
    const list = map.get(model.provider) ?? [];
    list.push(model);
    map.set(model.provider, list);
  }
  return [...map.entries()].map(([id, groupModels]) => ({
    id,
    label: id,
    models: groupModels,
  }));
}

export function isAdvancedRouteModel(model: CopilotModelRecord): boolean {
  const id = model.id.toLowerCase();
  const provider = model.provider.toLowerCase();
  return provider === "combo" || id.startsWith("auto/") || id.startsWith("combo/");
}

export type PersistedChartRestore = {
  symbol: string;
  interval: Interval;
  from: number;
  to: number;
  candle_count: number;
  shapes: PatternShape[];
  markers: AgentMarker[];
};
