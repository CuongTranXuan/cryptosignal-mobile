import type { Candle } from "./pattern-shape";

export type VisibleTimeRange = { from: number; to: number };

export type AnalysisWindow = {
  candles: Candle[];
  from: number;
  to: number;
  mode: "viewport" | "recent" | "all";
};

/** Soft-bind when the user clearly refers to what they see on screen. */
const VISIBLE_PROMPT_RE =
  /\b(this\s+window|visible(?:\s+(?:range|chart|area|bars?|portion))?|on\s+(?:the\s+)?screen|what\s+(?:am\s+i|i(?:'m| am))\s+(?:looking\s+at|seeing)|current\s+view|viewport)\b/i;

export const DEFAULT_PAD_BARS = 12;
export const TIGHT_PAD_BARS = 2;
/** Cap when the chart viewport is unknown so we do not dump full loaded history. */
export const FALLBACK_RECENT_BARS = 150;

export function promptRequestsVisibleWindow(prompt: string): boolean {
  return VISIBLE_PROMPT_RE.test(prompt);
}

/** Median bar duration from the trailing end of the series (seconds). */
export function estimateBarSeconds(candles: Candle[]): number {
  if (candles.length < 2) return 3600;
  const diffs: number[] = [];
  const start = Math.max(1, candles.length - 24);
  for (let i = start; i < candles.length; i++) {
    const d = candles[i]!.time - candles[i - 1]!.time;
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return 3600;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)]!;
}

/**
 * Pick the closed-candle slice the copilot should analyze.
 * Prefer the visible chart range (+ pad). Fall back to a recent tail, not full history.
 */
export function selectAnalysisCandles(
  closedCandles: Candle[],
  opts: {
    visibleRange?: VisibleTimeRange | null;
    prompt?: string;
    padBars?: number;
    tightPadBars?: number;
    fallbackRecentBars?: number;
    minBars?: number;
  } = {},
): AnalysisWindow {
  if (closedCandles.length === 0) {
    return { candles: [], from: 0, to: 0, mode: "all" };
  }

  const padBars = opts.padBars ?? DEFAULT_PAD_BARS;
  const tightPadBars = opts.tightPadBars ?? TIGHT_PAD_BARS;
  const fallbackRecentBars = opts.fallbackRecentBars ?? FALLBACK_RECENT_BARS;
  const minBars = opts.minBars ?? 3;
  const tight = opts.prompt ? promptRequestsVisibleWindow(opts.prompt) : false;
  const bars = tight ? tightPadBars : padBars;
  const barSec = estimateBarSeconds(closedCandles);
  const padSec = bars * barSec;

  const visible = opts.visibleRange;
  if (visible && Number.isFinite(visible.from) && Number.isFinite(visible.to) && visible.to > visible.from) {
    const fromBound = visible.from - padSec;
    const toBound = visible.to + padSec;
    const sliced = closedCandles.filter((c) => c.time >= fromBound && c.time <= toBound);
    if (sliced.length >= minBars) {
      return {
        candles: sliced,
        from: sliced[0]!.time,
        to: sliced[sliced.length - 1]!.time,
        mode: "viewport",
      };
    }
  }

  if (closedCandles.length > fallbackRecentBars) {
    const sliced = closedCandles.slice(-fallbackRecentBars);
    return {
      candles: sliced,
      from: sliced[0]!.time,
      to: sliced[sliced.length - 1]!.time,
      mode: "recent",
    };
  }

  return {
    candles: closedCandles,
    from: closedCandles[0]!.time,
    to: closedCandles[closedCandles.length - 1]!.time,
    mode: "all",
  };
}

/** Annotate the user prompt so the model knows the primary analysis window. */
export function annotatePromptWithWindow(prompt: string, window: AnalysisWindow): string {
  const focus =
    window.mode === "viewport"
      ? promptRequestsVisibleWindow(prompt)
        ? "Focus strictly on this visible chart window"
        : "Primary analysis window is the visible chart range (plus a small pad)"
      : window.mode === "recent"
        ? "Primary analysis window is the most recent closed candles"
        : "Primary analysis window is the provided closed-candle set";

  return (
    `${prompt}\n\n` +
    `[Analysis window] ${focus}: from=${window.from} to=${window.to} ` +
    `(${window.candles.length} closed candles, mode=${window.mode}). ` +
    `All PatternShape point.time values MUST fall inside this candle set. ` +
    `Prefer patterns in the most recent / visible portion unless the user named another range.`
  );
}

/** True when every time already sits inside the visible range (no need to scroll). */
export function timesInsideVisibleRange(
  times: number[],
  visible: VisibleTimeRange | null | undefined,
): boolean {
  if (!times.length) return true;
  if (!visible || !(visible.to > visible.from)) return false;
  return times.every((t) => t >= visible.from && t <= visible.to);
}
