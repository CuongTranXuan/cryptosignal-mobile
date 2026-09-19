import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/pattern-shape";
import {
  FALLBACK_RECENT_BARS,
  annotatePromptWithWindow,
  estimateBarSeconds,
  promptRequestsVisibleWindow,
  selectAnalysisCandles,
  timesInsideVisibleRange,
} from "../lib/analysis-window";

function candle(time: number): Candle {
  return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

function series(count: number, start = 1_700_000_000, step = 3600): Candle[] {
  return Array.from({ length: count }, (_, i) => candle(start + i * step));
}

describe("analysis-window", () => {
  it("detects visible-window phrasing", () => {
    expect(promptRequestsVisibleWindow("find triangles in this window")).toBe(true);
    expect(promptRequestsVisibleWindow("analyze the visible range")).toBe(true);
    expect(promptRequestsVisibleWindow("what am I looking at")).toBe(true);
    expect(promptRequestsVisibleWindow("Find symmetrical triangles")).toBe(false);
  });

  it("estimates bar seconds from trailing diffs", () => {
    expect(estimateBarSeconds(series(5, 0, 3600))).toBe(3600);
    expect(estimateBarSeconds([candle(10)])).toBe(3600);
  });

  it("slices closed candles to the visible range plus pad", () => {
    const candles = series(100);
    const visible = {
      from: candles[70]!.time,
      to: candles[90]!.time,
    };
    const window = selectAnalysisCandles(candles, { visibleRange: visible });
    expect(window.mode).toBe("viewport");
    expect(window.candles[0]!.time).toBeLessThanOrEqual(visible.from);
    expect(window.candles[window.candles.length - 1]!.time).toBeGreaterThanOrEqual(visible.to);
    expect(window.from).toBe(window.candles[0]!.time);
    expect(window.to).toBe(window.candles[window.candles.length - 1]!.time);
    // Default pad is 12 bars; clamp to series ends (90+12 would exceed length 100)
    expect(window.candles.length).toBeLessThan(candles.length);
    expect(window.candles[0]!.time).toBe(candles[70 - 12]!.time);
    expect(window.candles.at(-1)!.time).toBe(candles[99]!.time);
  });

  it("uses a tight pad when the prompt binds to the visible window", () => {
    const candles = series(80);
    const visible = { from: candles[40]!.time, to: candles[60]!.time };
    const window = selectAnalysisCandles(candles, {
      visibleRange: visible,
      prompt: "patterns in this window please",
    });
    expect(window.mode).toBe("viewport");
    expect(window.candles[0]!.time).toBe(candles[40 - 2]!.time);
    expect(window.candles.at(-1)!.time).toBe(candles[60 + 2]!.time);
  });

  it("falls back to a recent tail when viewport is missing and history is huge", () => {
    const candles = series(FALLBACK_RECENT_BARS + 80);
    const window = selectAnalysisCandles(candles, { visibleRange: null });
    expect(window.mode).toBe("recent");
    expect(window.candles).toHaveLength(FALLBACK_RECENT_BARS);
    expect(window.to).toBe(candles.at(-1)!.time);
    expect(window.from).toBe(candles[candles.length - FALLBACK_RECENT_BARS]!.time);
  });

  it("keeps the full small set when there is no viewport", () => {
    const candles = series(20);
    const window = selectAnalysisCandles(candles);
    expect(window.mode).toBe("all");
    expect(window.candles).toEqual(candles);
  });

  it("annotates the prompt with the analysis window", () => {
    const candles = series(5);
    const window = selectAnalysisCandles(candles, {
      visibleRange: { from: candles[1]!.time, to: candles[3]!.time },
      prompt: "visible range triangles",
      tightPadBars: 0,
      minBars: 1,
    });
    const annotated = annotatePromptWithWindow("visible range triangles", window);
    expect(annotated).toContain("visible range triangles");
    expect(annotated).toContain(`from=${window.from}`);
    expect(annotated).toContain(`to=${window.to}`);
    expect(annotated).toContain("mode=viewport");
  });

  it("detects whether shape times already sit in the viewport", () => {
    const visible = { from: 100, to: 200 };
    expect(timesInsideVisibleRange([120, 150], visible)).toBe(true);
    expect(timesInsideVisibleRange([120, 250], visible)).toBe(false);
    expect(timesInsideVisibleRange([120], null)).toBe(false);
  });
});
