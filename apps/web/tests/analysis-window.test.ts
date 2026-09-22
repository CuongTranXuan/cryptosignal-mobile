import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/pattern-shape";
import {
  FALLBACK_RECENT_BARS,
  annotatePromptWithWindow,
  detectExpandedRangeIntent,
  estimateBarSeconds,
  promptRequestsExpandedRange,
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

  it("detects user-defined / expanded range intent", () => {
    expect(promptRequestsExpandedRange("analyze full history")).toBe(true);
    expect(promptRequestsExpandedRange("use all candles")).toBe(true);
    expect(promptRequestsExpandedRange("look at the last 7 days")).toBe(true);
    expect(promptRequestsExpandedRange("last week structure")).toBe(true);
    expect(promptRequestsExpandedRange("last 50 bars")).toBe(true);
    expect(promptRequestsExpandedRange("from 1700000000 to 1700500000")).toBe(true);
    expect(promptRequestsExpandedRange("mark the earlier swing")).toBe(true);
    expect(promptRequestsExpandedRange("before the breakout")).toBe(true);
    expect(promptRequestsExpandedRange("Find symmetrical triangles")).toBe(false);
    expect(promptRequestsExpandedRange("patterns in this window")).toBe(false);

    expect(detectExpandedRangeIntent("full history")?.kind).toBe("all");
    expect(detectExpandedRangeIntent("last 3 weeks")).toEqual({
      kind: "recent",
      durationSec: 3 * 7 * 86_400,
    });
    expect(detectExpandedRangeIntent("last 40 candles")).toEqual({
      kind: "recent",
      bars: 40,
    });
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

  it("does not hard-lock to viewport when the user asks for full history", () => {
    const candles = series(100);
    const visible = { from: candles[80]!.time, to: candles[95]!.time };
    const window = selectAnalysisCandles(candles, {
      visibleRange: visible,
      prompt: "draw the major trend across full history",
    });
    expect(window.mode).toBe("all");
    expect(window.candles).toEqual(candles);
    const annotated = annotatePromptWithWindow("draw the major trend across full history", window);
    expect(annotated).toContain("mode=all");
    expect(annotated).toMatch(/named another range|full\/loaded history/i);
    expect(annotated).toMatch(/do not restrict to the chart viewport/i);
  });

  it("widens to last N bars when the prompt names that window", () => {
    const candles = series(200);
    const visible = { from: candles[180]!.time, to: candles[195]!.time };
    const window = selectAnalysisCandles(candles, {
      visibleRange: visible,
      prompt: "analyze the last 50 bars",
    });
    expect(window.mode).toBe("prompt");
    expect(window.candles.length).toBeGreaterThanOrEqual(50);
    // Must include bars well before the viewport start.
    expect(window.candles[0]!.time).toBeLessThan(visible.from);
    expect(window.to).toBe(candles.at(-1)!.time);
  });

  it("widens to last N days covering the named span", () => {
    const candles = series(200); // hourly
    const visible = { from: candles[190]!.time, to: candles[199]!.time };
    const window = selectAnalysisCandles(candles, {
      visibleRange: visible,
      prompt: "mark support from the last 2 days",
      padBars: 0,
    });
    expect(window.mode).toBe("prompt");
    const span = window.to - window.from;
    expect(span).toBeGreaterThanOrEqual(2 * 86_400 - 3600);
    expect(window.candles[0]!.time).toBeLessThan(visible.from);
  });

  it("slices to an explicit from–to unix span (union with viewport)", () => {
    const candles = series(100);
    const visible = { from: candles[70]!.time, to: candles[90]!.time };
    const from = candles[10]!.time;
    const to = candles[30]!.time;
    const window = selectAnalysisCandles(candles, {
      visibleRange: visible,
      prompt: `draw from ${from} to ${to}`,
      padBars: 0,
      minBars: 1,
    });
    expect(window.mode).toBe("prompt");
    // Union of named span and viewport.
    expect(window.from).toBeLessThanOrEqual(from);
    expect(window.to).toBeGreaterThanOrEqual(visible.to);
    expect(window.candles.some((c) => c.time === candles[10]!.time)).toBe(true);
    expect(window.candles.some((c) => c.time === candles[80]!.time)).toBe(true);
  });

  it("expands for earlier/previous relative intent beyond the viewport", () => {
    const candles = series(80);
    const visible = { from: candles[60]!.time, to: candles[75]!.time };
    const window = selectAnalysisCandles(candles, {
      visibleRange: visible,
      prompt: "label the earlier swing before the breakout",
    });
    expect(window.mode).toBe("prompt");
    expect(window.candles).toEqual(candles);
    const annotated = annotatePromptWithWindow(
      "label the earlier swing before the breakout",
      window,
    );
    expect(annotated).toContain("mode=prompt");
    expect(annotated).toMatch(/user named another analysis\/draw range/i);
  });

  it("keeps viewport slice when there is no expansion intent (avoids old rediscovery)", () => {
    const candles = series(100);
    // Simulate an old ~82.3k-era structure living only in early bars.
    const visible = { from: candles[85]!.time, to: candles[99]!.time };
    const window = selectAnalysisCandles(candles, {
      visibleRange: visible,
      prompt: "Find symmetrical triangles",
    });
    expect(window.mode).toBe("viewport");
    expect(window.candles[0]!.time).toBeGreaterThan(candles[0]!.time);
    expect(window.candles.every((c) => c.time >= candles[85 - 12]!.time)).toBe(true);
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
