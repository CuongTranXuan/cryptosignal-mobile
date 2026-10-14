import type { CopilotModelRecord } from "./copilot-schema";

/** UI preset buttons (product decision; spec §2.2 lists a different server preset table). */
export const UI_CANDLE_PRESETS = [50, 100, 200, 300] as const;

export const DEFAULT_CANDLE_COUNT = 100;

export function recommendedMaxCandles(model: CopilotModelRecord | null): number {
  return model?.recommended_max_candles ?? 500;
}

export function clampCandleCountForModel(
  requested: number,
  model: CopilotModelRecord | null,
  closedAvailable?: number,
): number {
  const max = recommendedMaxCandles(model);
  let n = Math.floor(requested);
  if (!Number.isFinite(n) || n < 1) n = DEFAULT_CANDLE_COUNT;
  n = Math.min(n, max);
  if (closedAvailable != null && closedAvailable > 0) {
    n = Math.min(n, closedAvailable);
  }
  return n;
}

export function formatModelLimitsLine(model: CopilotModelRecord): string {
  const reasoning = model.supports_reasoning ? "có lý luận" : "không lý luận";
  const ctxK = Math.round(model.context_window / 1000);
  const outK = Math.round(model.max_output_tokens / 1000);
  return `${ctxK}k ctx · ${outK}k out · ${reasoning}`;
}
