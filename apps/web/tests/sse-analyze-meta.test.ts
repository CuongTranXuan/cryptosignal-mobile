import { describe, expect, it } from "vitest";
import { mergeAnalyzeMeta } from "../lib/sse-analyze-meta";
import type { AnalyzeMetaEvent } from "../lib/copilot-schema";

describe("mergeAnalyzeMeta", () => {
  it("preserves telemetry when final meta only adds fallback flags", () => {
    const initial: AnalyzeMetaEvent = {
      model: "provider-a/model-alpha",
      candle_count_requested: 300,
      candle_count_used: 200,
      clamped: true,
      htf: { interval: "4h", bars: 50, last_closed_time: 1700000000 },
    };
    const final: AnalyzeMetaEvent = {
      model: "provider-a/model-alpha",
      candle_count_requested: 300,
      candle_count_used: 200,
      clamped: true,
      intent_budget_fallback: true,
    };
    const merged = mergeAnalyzeMeta(initial, final);
    expect(merged.candle_count_used).toBe(200);
    expect(merged.candle_count_requested).toBe(300);
    expect(merged.clamped).toBe(true);
    expect(merged.htf?.bars).toBe(50);
    expect(merged.intent_budget_fallback).toBe(true);
    expect(merged.validator_fallback).toBeUndefined();
  });

  it("lets later meta overwrite overlapping fields", () => {
    const first: AnalyzeMetaEvent = {
      model: "old",
      candle_count_requested: 100,
      candle_count_used: 100,
      clamped: false,
    };
    const second: AnalyzeMetaEvent = {
      model: "new",
      candle_count_requested: 150,
      candle_count_used: 150,
      clamped: false,
      validator_fallback: true,
    };
    const merged = mergeAnalyzeMeta(first, second);
    expect(merged.model).toBe("new");
    expect(merged.candle_count_used).toBe(150);
    expect(merged.validator_fallback).toBe(true);
  });
});
