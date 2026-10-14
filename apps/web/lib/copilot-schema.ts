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

export const AnalyzeMetaEventSchema = z.object({
  model: z.string(),
  candle_count_requested: z.number(),
  candle_count_used: z.number(),
  clamped: z.boolean(),
  max_tokens: z.number().optional(),
  reasoning_effort: z.string().nullable().optional(),
  retried: z.boolean().optional(),
});

export type AnalyzeMetaEvent = z.infer<typeof AnalyzeMetaEventSchema>;

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
  chart: SessionChartSchema,
  messages: z.array(SessionMessageSchema),
});

export type CopilotSessionApi = z.infer<typeof CopilotSessionApiSchema>;

export const CreateSessionRequestSchema = z.object({
  title: z.string(),
  model_id: z.string(),
  reasoning_effort: z.string().nullable().optional(),
  chart: SessionChartSchema,
  messages: z.array(SessionMessageSchema).optional(),
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const UpdateSessionRequestSchema = z.object({
  title: z.string().optional(),
  model_id: z.string().optional(),
  reasoning_effort: z.string().nullable().optional(),
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
