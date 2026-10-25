import {
  SkippedEntrySchema,
  type AnalyzeIntent,
  type ChartBias,
  type ChartStyleId,
  type SkippedEntry,
  type SkippedReasonCode,
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

const SKIPPED_REASON_VI: Record<SkippedReasonCode, string> = {
  low_confidence: "độ tin cậy thấp",
  out_of_window: "ngoài khung thời gian",
  invalid_geometry: "hình học không hợp lệ",
  no_candidate: "không có mẫu phù hợp",
  unsupported_pattern: "mẫu không được hỗ trợ",
};

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

function humanizeId(id: string): string {
  return id.replace(/_/g, " ");
}

export const DEFAULT_ANALYZE_INTENT: AnalyzeIntent = { style: "classic" };

/** Request body `intent` — style defaults to classic; omit empty optional fields. */
export function serializeAnalyzeIntent(intent: AnalyzeIntent): Record<string, unknown> {
  const style = intent.style ?? "classic";
  const out: Record<string, unknown> = { style };
  if (intent.bias) out.bias = intent.bias;
  if (intent.requested_pattern) out.requested_pattern = intent.requested_pattern;
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
  const parts = normalized.map(
    (e) => `${e.count} ${SKIPPED_REASON_VI[e.reason_code] ?? e.reason_code}`,
  );
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
    if (parsed.success) entries.push(parsed.data);
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
