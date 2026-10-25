import { describe, expect, it } from "vitest";
import {
  AnalyzeMetaEventSchema,
  AnalyzeIntentSchema,
  DrawingGuardrailSchema,
  IntentCheckSchema,
} from "../lib/copilot-schema";
import { PatternShapeSchema } from "../lib/pattern-shape";
import {
  formatBiasConflictNotice,
  formatSkippedBreakdown,
  labelForPattern,
  labelForStyle,
  normalizeSkippedEntries,
  parseSkippedFromPayload,
  serializeAnalyzeIntent,
  fallbackStylesCatalog,
} from "../lib/copilot-chart-ai";

describe("copilot-chart-ai", () => {
  it("serializes analyze intent with defaults and optional fields", () => {
    expect(serializeAnalyzeIntent({ style: "classic" })).toEqual({ style: "classic" });
    expect(
      serializeAnalyzeIntent({
        style: "smc",
        bias: "bullish",
        requested_pattern: "order_block",
      }),
    ).toEqual({
      style: "smc",
      bias: "bullish",
      requested_pattern: "order_block",
    });
    const parsed = AnalyzeIntentSchema.parse({ style: "wyckoff" });
    expect(parsed.style).toBe("wyckoff");
  });

  it("labels known styles and patterns with Vietnamese copy and falls back for unknown ids", () => {
    expect(labelForStyle("classic")).toBe("Cổ điển");
    expect(labelForPattern("head_and_shoulders")).toBe("Vai đầu vai");
    expect(labelForPattern("custom_pattern_xyz")).toBe("custom pattern xyz");
    expect(labelForStyle("future_style")).toBe("future style");
  });

  it("parses guardrail and intent_check while old meta still validates", () => {
    const guardrail = {
      regime: "trend_up",
      confidence: 0.82,
      evidence_against: ["volume weak"],
      invalidation: { price: 42_000, condition: "close below" },
    };
    DrawingGuardrailSchema.parse(guardrail);

    const shape = PatternShapeSchema.parse({
      id: "shape-1",
      symbol: "BTCUSDT",
      interval: "1h",
      kind: "trendline",
      name: "TL",
      status: "committed",
      source: "agent",
      confidence: 0.7,
      points: [
        { time: 1, price: 1 },
        { time: 2, price: 2 },
      ],
      priceLow: null,
      priceHigh: null,
      guardrail,
    });
    expect(shape.guardrail?.regime).toBe("trend_up");

    const legacyMeta = AnalyzeMetaEventSchema.parse({
      model: "m",
      candle_count_requested: 100,
      candle_count_used: 100,
      clamped: false,
    });
    expect(legacyMeta.intent_check).toBeUndefined();

    const richMeta = AnalyzeMetaEventSchema.parse({
      ...legacyMeta,
      intent_check: IntentCheckSchema.parse({
        detected_regime: "trend_down",
        bias_conflict: true,
        message: "Xu hướng giảm trái với bias tăng",
      }),
      skipped: [{ reason_code: "low_confidence", count: 2 }],
    });
    expect(richMeta.intent_check?.bias_conflict).toBe(true);
  });

  it("formats skipped breakdown in Vietnamese with skipped_count fallback", () => {
    const entries = normalizeSkippedEntries(undefined, 3);
    expect(entries).toEqual([{ reason_code: "no_candidate", count: 3 }]);
    const text = formatSkippedBreakdown([
      { reason_code: "low_confidence", count: 2 },
      { reason_code: "out_of_window", count: 1 },
    ]);
    expect(text).toContain("Bỏ qua 3 hình");
    expect(text).toContain("2 độ tin cậy thấp");
    expect(text).toContain("1 ngoài khung thời gian");

    const fromPayload = parseSkippedFromPayload({
      skipped_count: 5,
    });
    expect(formatSkippedBreakdown(fromPayload)).toContain("Bỏ qua 5 hình");
  });

  it("formats bias conflict notice with optional server message", () => {
    expect(formatBiasConflictNotice("Tùy chỉnh")).toContain("Tùy chỉnh");
    expect(formatBiasConflictNotice()).toContain("mâu thuẫn");
  });

  it("exposes styles fallback catalog ids", () => {
    const catalog = fallbackStylesCatalog();
    expect(catalog.styles.some((s) => s.id === "smc")).toBe(true);
    expect(catalog.styles[0]?.patterns.length).toBeGreaterThan(0);
  });
});
