import { describe, expect, it } from "vitest";
import {
  AnalyzeMetaEventSchema,
  AnalyzeIntentSchema,
  DrawingGuardrailSchema,
  IntentCheckSchema,
} from "../lib/copilot-schema";
import { PatternShapeSchema } from "../lib/pattern-shape";
import {
  formatAnalysisSummaryVi,
  labelForSummaryDirection,
  formatSkippedBreakdown,
  isAnalysisSseEmpty,
  parseAnalysisSseEvent,
  labelForHorizon,
  labelForPattern,
  labelForSkippedReason,
  labelForStyle,
  normalizeSkippedEntries,
  parseSkippedFromPayload,
  displaySessionIntent,
  sanitizeIntentForStyle,
  serializeAnalyzeIntent,
} from "../lib/copilot-chart-ai";
import { formatMetaHtfLine } from "../lib/htf-format";
import { MOCK_STYLES_RESPONSE } from "../lib/copilot-api";

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
    expect(labelForSkippedReason("cap")).toBe("vượt giới hạn 6 hình");
    expect(formatSkippedBreakdown([{ reason_code: "cap", count: 2 }])).toContain(
      "vượt giới hạn 6 hình",
    );

    const fromPayload = parseSkippedFromPayload({
      skipped_count: 5,
    });
    expect(formatSkippedBreakdown(fromPayload)).toContain("Bỏ qua 5 hình");

    const unknown = parseSkippedFromPayload({
      skipped: [{ reason_code: "future_reason", count: 1 }],
    });
    expect(formatSkippedBreakdown(unknown)).toContain("future reason");
  });

  it("treats empty analysis SSE as hidden and formats filled analysis in Vietnamese", () => {
    expect(isAnalysisSseEmpty({})).toBe(true);
    expect(parseAnalysisSseEvent({})).not.toBeNull();
    const emptyParsed = parseAnalysisSseEvent({});
    expect(emptyParsed && formatAnalysisSummaryVi(emptyParsed)).toBeNull();

    const filled = parseAnalysisSseEvent({
      bias: "bearish",
      evidence_against: ["volume yếu"],
      confidence: 0.72,
      invalidation: { price: 42_000, condition: "close_below" },
    });
    expect(filled).not.toBeNull();
    const text = formatAnalysisSummaryVi(filled!);
    expect(text).toContain("Giảm");
    expect(text).toContain("volume yếu");
    expect(text).toContain("42,000.00");
    expect(text).toContain("Đóng nến dưới");
  });

  it("labels horizon and formats meta htf line when present", () => {
    expect(labelForHorizon("swing")).toBe("Swing");
    expect(formatMetaHtfLine(null)).toBeNull();
    expect(
      formatMetaHtfLine({
        model: "m",
        candle_count_requested: 1,
        candle_count_used: 1,
        clamped: false,
        htf: { interval: "4h", regime: "trend_up" },
      }),
    ).toContain("4h");
  });

  it("accepts meta with cap skipped and intent_budget_fallback", () => {
    const meta = AnalyzeMetaEventSchema.parse({
      model: "m",
      candle_count_requested: 50,
      candle_count_used: 50,
      clamped: false,
      preview_shape_budget: 6,
      intent_budget_fallback: true,
      validator_fallback: true,
      skipped: [{ reason_code: "cap", count: 3 }],
    });
    expect(meta.preview_shape_budget).toBe(6);
    expect(meta.intent_budget_fallback).toBe(true);
    expect(meta.validator_fallback).toBe(true);
  });

  it("labels summary_direction for analysis card", () => {
    expect(labelForSummaryDirection("conditional")).toBe("Có điều kiện");
    const summary = formatAnalysisSummaryVi({
      summary_direction: "bullish",
      evidence_for: [],
      evidence_against: [],
    });
    expect(summary).toContain("Tăng");
  });

  it("displays null session intent as classic default and sanitizes patterns per style", () => {
    expect(displaySessionIntent(null).style).toBe("classic");
    const sanitized = sanitizeIntentForStyle(
      { style: "elliott", requested_pattern: "trendline" },
      [],
    );
    expect(sanitized.requested_pattern).toBeUndefined();
  });

  it("mock styles match backend empty elliott/wyckoff pattern lists", () => {
    const elliott = MOCK_STYLES_RESPONSE.styles.find((s) => s.id === "elliott");
    expect(elliott?.patterns).toEqual([]);
  });
});
