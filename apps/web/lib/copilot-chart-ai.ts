import {
  AnalysisSseEventSchema,
  SkippedEntrySchema,
  type AnalysisSseEvent,
  type AnalyzeIntent,
  type AnalyzeMetaEvent,
  type ChartBias,
  type ChartHorizon,
  type ChartStyleId,
  type DrawingRegime,
  type KnownSkippedReasonCode,
  type SkippedEntry,
} from "./copilot-schema";

export const KNOWN_PATTERN_IDS = [
  "head_and_shoulders",
  "inverse_head_and_shoulders",
  "double_top",
  "double_bottom",
  "ascending_triangle",
  "descending_triangle",
  "symmetrical_triangle",
  "channel_up",
  "channel_down",
  "trendline",
  "support_resistance",
  "fib_retracement",
  "bos",
  "choch",
  "fvg",
  "order_block",
  "liquidity",
] as const;

export type KnownPatternId = (typeof KNOWN_PATTERN_IDS)[number];

const STYLE_LABELS_VI: Record<ChartStyleId, string> = {
  classic: "Cổ điển",
  smc: "SMC",
  elliott: "Elliott",
  wyckoff: "Wyckoff",
};

const BIAS_LABELS_VI: Record<ChartBias, string> = {
  bullish: "Tăng",
  bearish: "Giảm",
  neutral: "Trung lập",
};

const PATTERN_LABELS_VI: Record<KnownPatternId, string> = {
  head_and_shoulders: "Vai đầu vai",
  inverse_head_and_shoulders: "Vai đầu vai ngược",
  double_top: "Đỉnh đôi",
  double_bottom: "Đáy đôi",
  ascending_triangle: "Tam giác tăng",
  descending_triangle: "Tam giác giảm",
  symmetrical_triangle: "Tam giác cân",
  channel_up: "Kênh tăng",
  channel_down: "Kênh giảm",
  trendline: "Đường xu hướng",
  support_resistance: "Hỗ trợ / kháng cự",
  fib_retracement: "Fibonacci hồi",
  bos: "BOS",
  choch: "CHoCH",
  fvg: "FVG",
  order_block: "Order block",
  liquidity: "Thanh khoản",
};

const REGIME_LABELS_VI: Record<string, string> = {
  trend_up: "xu hướng tăng",
  trend_down: "xu hướng giảm",
  range: "đi ngang",
  volatile: "biến động mạnh",
};

const SKIPPED_REASON_VI: Record<KnownSkippedReasonCode, string> = {
  low_confidence: "độ tin cậy thấp",
  out_of_window: "ngoài khung thời gian",
  invalid_geometry: "hình học không hợp lệ",
  no_candidate: "không có mẫu phù hợp",
  unsupported_pattern: "mẫu không được hỗ trợ",
  cap: "vượt giới hạn 6 hình",
};

export function labelForSkippedReason(reasonCode: string): string {
  if (reasonCode in SKIPPED_REASON_VI) {
    return SKIPPED_REASON_VI[reasonCode as KnownSkippedReasonCode];
  }
  return humanizeId(reasonCode);
}

export function labelForStyle(id: ChartStyleId | string): string {
  if (id in STYLE_LABELS_VI) return STYLE_LABELS_VI[id as ChartStyleId];
  return humanizeId(id);
}

export function labelForBias(bias: ChartBias): string {
  return BIAS_LABELS_VI[bias];
}

export function labelForPattern(id: string): string {
  if (id in PATTERN_LABELS_VI) return PATTERN_LABELS_VI[id as KnownPatternId];
  return humanizeId(id);
}

export function labelForRegime(regime: string): string {
  return REGIME_LABELS_VI[regime] ?? humanizeId(regime);
}

/** Parse `analysis` SSE payload; never throws — returns null when unrecoverable. */
export function parseAnalysisSseEvent(data: Record<string, unknown>): AnalysisSseEvent | null {
  const parsed = AnalysisSseEventSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  return null;
}

export function isAnalysisSseEmpty(analysis: Partial<AnalysisSseEvent>): boolean {
  if (analysis.no_valid_pattern) return false;
  const bias = analysis.bias;
  const hasBias = bias != null && bias !== "neutral";
  const hasEvidence =
    (analysis.evidence_for?.length ?? 0) > 0 || (analysis.evidence_against?.length ?? 0) > 0;
  const hasConfidence = analysis.confidence != null && Number.isFinite(analysis.confidence);
  const hasInvalidation = analysis.invalidation != null;
  return !hasBias && !hasEvidence && !hasConfidence && !hasInvalidation;
}

/** Compact Vietnamese summary for the analysis card; null when nothing to show. */
export function formatAnalysisSummaryVi(analysis: AnalysisSseEvent): string | null {
  if (isAnalysisSseEmpty(analysis)) return null;
  const lines: string[] = [];
  if (analysis.no_valid_pattern) {
    lines.push("Không có mẫu hình hợp lệ trong cửa sổ này.");
  }
  if (analysis.bias && analysis.bias !== "neutral") {
    lines.push(`Bias phát hiện: ${labelForBias(analysis.bias)}.`);
  }
  if (analysis.confidence != null && Number.isFinite(analysis.confidence)) {
    lines.push(`Độ tin cậy tổng hợp: ${Math.round(analysis.confidence * 100)}%.`);
  }
  const forLines = analysis.evidence_for ?? [];
  if (forLines.length > 0) {
    lines.push(`Bằng chứng thuận: ${forLines.join("; ")}`);
  }
  const againstLines = analysis.evidence_against ?? [];
  if (againstLines.length > 0) {
    lines.push(`Bằng chứng ngược: ${againstLines.join("; ")}`);
  }
  const inv = analysis.invalidation;
  if (inv != null) {
    const cond = inv.condition ? ` (${inv.condition})` : "";
    lines.push(`Vô hiệu hóa: ${inv.price}${cond}`);
  }
  return lines.join("\n");
}

export function formatDetectedRegimeLabel(regime: DrawingRegime | string): string {
  return labelForRegime(regime);
}

function humanizeId(id: string): string {
  return id.replace(/_/g, " ");
}

export const DEFAULT_ANALYZE_INTENT: AnalyzeIntent = { style: "classic" };

/** Request body `intent` — style defaults to classic; omit empty optional fields. */
const HORIZON_LABELS_VI: Record<ChartHorizon, string> = {
  scalp: "Lướt ngắn",
  swing: "Swing",
  position: "Vị thế dài",
};

export function labelForHorizon(horizon: ChartHorizon): string {
  return HORIZON_LABELS_VI[horizon];
}

export function formatMetaHtfLine(meta: AnalyzeMetaEvent | null | undefined): string | null {
  const htf = meta?.htf;
  if (!htf || typeof htf !== "object") return null;
  const interval = typeof htf.interval === "string" ? htf.interval : null;
  const regime = typeof htf.regime === "string" ? labelForRegime(htf.regime) : null;
  if (!interval && !regime) return null;
  if (interval && regime) return `Khung cao hơn (${interval}): ${regime}.`;
  if (interval) return `Khung cao hơn: ${interval}.`;
  return `Khung cao hơn: ${regime}.`;
}

export function serializeAnalyzeIntent(intent: AnalyzeIntent): Record<string, unknown> {
  const style = intent.style ?? "classic";
  const out: Record<string, unknown> = { style };
  if (intent.bias) out.bias = intent.bias;
  if (intent.requested_pattern) out.requested_pattern = intent.requested_pattern;
  if (intent.horizon) out.horizon = intent.horizon;
  return out;
}

export function normalizeSkippedEntries(
  skipped: SkippedEntry[] | undefined,
  skippedCountFallback?: number,
): SkippedEntry[] {
  if (skipped && skipped.length > 0) {
    return skipped.filter((e) => e.count > 0);
  }
  if (skippedCountFallback != null && skippedCountFallback > 0) {
    return [{ reason_code: "no_candidate", count: skippedCountFallback }];
  }
  return [];
}

export function formatSkippedBreakdown(entries: SkippedEntry[]): string | null {
  const normalized = normalizeSkippedEntries(entries);
  if (normalized.length === 0) return null;
  const total = normalized.reduce((sum, e) => sum + e.count, 0);
  const parts = normalized.map((e) => `${e.count} ${labelForSkippedReason(e.reason_code)}`);
  return `\n\nBỏ qua ${total} hình: ${parts.join(", ")}.`;
}

export function formatBiasConflictNotice(message?: string): string {
  if (message?.trim()) {
    return `\n\n⚠ ${message.trim()}`;
  }
  return "\n\n⚠ Xu hướng bạn chọn mâu thuẫn với chế độ thị trường mà hệ thống phát hiện.";
}

export function parseSkippedFromPayload(data: Record<string, unknown>): SkippedEntry[] {
  const raw = data.skipped;
  if (!Array.isArray(raw)) {
    const fallback =
      typeof data.skipped_count === "number" ? data.skipped_count : undefined;
    return normalizeSkippedEntries(undefined, fallback);
  }
  const entries: SkippedEntry[] = [];
  for (const item of raw) {
    const parsed = SkippedEntrySchema.safeParse(item);
    if (parsed.success) {
      entries.push(parsed.data);
      continue;
    }
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const code = typeof row.reason_code === "string" ? row.reason_code : "";
      const count = typeof row.count === "number" ? row.count : 0;
      if (code && count > 0) entries.push({ reason_code: code, count });
    }
  }
  return normalizeSkippedEntries(entries);
}

/** UI display when session/API intent is null (server default is classic). */
export function displaySessionIntent(
  intent: import("./copilot-schema").AnalyzeIntent | null | undefined,
): AnalyzeIntent {
  if (!intent) return { ...DEFAULT_ANALYZE_INTENT };
  return { ...DEFAULT_ANALYZE_INTENT, ...intent };
}

export function sanitizeIntentForStyle(
  intent: AnalyzeIntent,
  patternIdsForStyle: string[],
): AnalyzeIntent {
  const next = { ...intent };
  if (
    next.requested_pattern &&
    !patternIdsForStyle.includes(next.requested_pattern)
  ) {
    delete next.requested_pattern;
  }
  return next;
}
