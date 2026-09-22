import type { Candle } from "./pattern-shape";

export type VisibleTimeRange = { from: number; to: number };

export type AnalysisWindowMode = "viewport" | "recent" | "all" | "prompt";

export type AnalysisWindow = {
  candles: Candle[];
  from: number;
  to: number;
  mode: AnalysisWindowMode;
};

/** Soft-bind when the user clearly refers to what they see on screen. */
const VISIBLE_PROMPT_RE =
  /\b(this\s+window|visible(?:\s+(?:range|chart|area|bars?|portion))?|on\s+(?:the\s+)?screen|what\s+(?:am\s+i|i(?:'m| am))\s+(?:looking\s+at|seeing)|current\s+view|viewport)\b/i;

/** Full loaded history / every candle. */
const FULL_HISTORY_RE =
  /\b(full\s+history|entire\s+(?:history|chart|series)|all\s+(?:the\s+)?(?:candles?|bars?|history|data|loaded)|whole\s+(?:chart|history|series)|everything\s+(?:loaded|available)|complete\s+history)\b/i;

/** last N days|weeks|months|hours|bars|candles, or last week/day/… */
const LAST_N_RE =
  /\blast\s+(\d+)\s*(days?|weeks?|months?|bars?|candles?|hours?)\b/i;
const LAST_UNIT_RE = /\blast\s+(day|week|month|hour)\b/i;

/** Explicit from/to unix (seconds or ms). */
const FROM_TO_UNIX_RE =
  /\b(?:from|between)\s+(\d{9,13})\s*(?:to|and|-|–|—)\s*(\d{9,13})\b/i;

/** Standalone unix seconds/ms that look like chart times (~2015–2035). */
const UNIX_TOKEN_RE = /\b(1[6-9]\d{8}|2[0-2]\d{8}|1[6-9]\d{11}|2[0-2]\d{11})\b/g;

/**
 * Relative / expanded intent without a hard numeric span — earlier swing,
 * before/after a level, previous structure, etc.
 */
const RELATIVE_EXPAND_RE =
  /\b(earlier|previous|prior|older|past)\b|\b(before|after)\s+(?:the\s+)?(?:swing|breakout|level|high|low|move|leg|range|triangle|pattern)\b|\boutside\s+(?:the\s+)?(?:viewport|visible|window)\b|\bbeyond\s+(?:what(?:'s| is)\s+)?(?:visible|shown)\b|\bscroll\s+back\b|\bgo\s+back\b|\bolder\s+history\b/i;

export const DEFAULT_PAD_BARS = 12;
export const TIGHT_PAD_BARS = 2;
/** Cap when the chart viewport is unknown so we do not dump full loaded history. */
export const FALLBACK_RECENT_BARS = 150;

export type ExpandedRangeIntent =
  | { kind: "all" }
  | { kind: "recent"; bars?: number; durationSec?: number }
  | { kind: "span"; from: number; to: number }
  | { kind: "relative" };

export function promptRequestsVisibleWindow(prompt: string): boolean {
  return VISIBLE_PROMPT_RE.test(prompt);
}

/** True when the user named another analysis / draw window (not just the viewport default). */
export function promptRequestsExpandedRange(prompt: string): boolean {
  return detectExpandedRangeIntent(prompt) !== null;
}

function normalizeUnixToken(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  // ms timestamps are 13 digits / > 1e12
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

function unitToSeconds(n: number, unit: string): number | null {
  const u = unit.toLowerCase();
  if (u.startsWith("day")) return n * 86_400;
  if (u.startsWith("week")) return n * 7 * 86_400;
  if (u.startsWith("month")) return n * 30 * 86_400;
  if (u.startsWith("hour")) return n * 3_600;
  return null; // bars/candles handled separately
}

export function detectExpandedRangeIntent(prompt: string): ExpandedRangeIntent | null {
  if (!prompt || !prompt.trim()) return null;

  if (FULL_HISTORY_RE.test(prompt)) {
    return { kind: "all" };
  }

  const fromTo = prompt.match(FROM_TO_UNIX_RE);
  if (fromTo) {
    const a = normalizeUnixToken(fromTo[1]!);
    const b = normalizeUnixToken(fromTo[2]!);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      return { kind: "span", from: Math.min(a, b), to: Math.max(a, b) };
    }
  }

  const lastN = prompt.match(LAST_N_RE);
  if (lastN) {
    const n = Number(lastN[1]);
    const unit = lastN[2]!;
    if (Number.isFinite(n) && n > 0) {
      const asBars = /^(bars?|candles?)$/i.test(unit);
      if (asBars) return { kind: "recent", bars: Math.floor(n) };
      const durationSec = unitToSeconds(n, unit);
      if (durationSec != null) return { kind: "recent", durationSec };
    }
  }

  const lastUnit = prompt.match(LAST_UNIT_RE);
  if (lastUnit) {
    const durationSec = unitToSeconds(1, lastUnit[1]!);
    if (durationSec != null) return { kind: "recent", durationSec };
  }

  const unixMatches = [...prompt.matchAll(UNIX_TOKEN_RE)].map((m) => normalizeUnixToken(m[1]!));
  const validUnix = unixMatches.filter((t) => Number.isFinite(t));
  if (validUnix.length >= 2) {
    return {
      kind: "span",
      from: Math.min(...validUnix),
      to: Math.max(...validUnix),
    };
  }
  if (validUnix.length === 1) {
    // Single named time: treat as an anchor — expand to include it (span centered later).
    const t = validUnix[0]!;
    return { kind: "span", from: t, to: t };
  }

  if (RELATIVE_EXPAND_RE.test(prompt)) {
    return { kind: "relative" };
  }

  return null;
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

function windowFromCandles(
  sliced: Candle[],
  mode: AnalysisWindowMode,
): AnalysisWindow {
  if (sliced.length === 0) {
    return { candles: [], from: 0, to: 0, mode };
  }
  return {
    candles: sliced,
    from: sliced[0]!.time,
    to: sliced[sliced.length - 1]!.time,
    mode,
  };
}

function sliceByTimeBounds(
  closedCandles: Candle[],
  fromBound: number,
  toBound: number,
): Candle[] {
  return closedCandles.filter((c) => c.time >= fromBound && c.time <= toBound);
}

/**
 * When the user named a range, widen beyond the viewport default.
 * Prefer real closed candles covering that range over inventing times.
 */
function selectForExpandedIntent(
  closedCandles: Candle[],
  intent: ExpandedRangeIntent,
  opts: {
    visibleRange?: VisibleTimeRange | null;
    padSec: number;
    minBars: number;
    fallbackRecentBars: number;
  },
): AnalysisWindow {
  const { visibleRange, padSec, minBars, fallbackRecentBars } = opts;
  const last = closedCandles[closedCandles.length - 1]!;
  const first = closedCandles[0]!;

  if (intent.kind === "all" || intent.kind === "relative") {
    // Enough history for a named older structure / full series.
    return windowFromCandles(closedCandles, intent.kind === "all" ? "all" : "prompt");
  }

  if (intent.kind === "recent") {
    let sliced: Candle[];
    if (intent.bars != null) {
      const n = Math.max(intent.bars, minBars);
      sliced = closedCandles.slice(-n);
    } else {
      const duration = intent.durationSec ?? fallbackRecentBars * estimateBarSeconds(closedCandles);
      const fromBound = last.time - duration - padSec;
      sliced = sliceByTimeBounds(closedCandles, fromBound, last.time + padSec);
      if (sliced.length < minBars) {
        sliced = closedCandles.slice(-Math.max(fallbackRecentBars, minBars));
      }
    }
    // Union with viewport so a recent named window still includes what is on screen.
    if (visibleRange && visibleRange.to > visibleRange.from) {
      const unionFrom = Math.min(sliced[0]?.time ?? first.time, visibleRange.from - padSec);
      const unionTo = Math.max(
        sliced[sliced.length - 1]?.time ?? last.time,
        visibleRange.to + padSec,
      );
      sliced = sliceByTimeBounds(closedCandles, unionFrom, unionTo);
    }
    return windowFromCandles(sliced, "prompt");
  }

  // span
  let fromBound = intent.from - padSec;
  let toBound = intent.to + padSec;
  if (intent.from === intent.to) {
    // Single unix anchor: include a useful neighborhood + pad.
    const barSec = estimateBarSeconds(closedCandles);
    fromBound = intent.from - Math.max(padSec, 24 * barSec);
    toBound = intent.to + Math.max(padSec, 24 * barSec);
  }
  if (visibleRange && visibleRange.to > visibleRange.from) {
    fromBound = Math.min(fromBound, visibleRange.from - padSec);
    toBound = Math.max(toBound, visibleRange.to + padSec);
  }
  let sliced = sliceByTimeBounds(closedCandles, fromBound, toBound);
  if (sliced.length < minBars) {
    // Prefer sending all loaded candles over inventing times outside the set.
    sliced = closedCandles;
    return windowFromCandles(sliced, "prompt");
  }
  return windowFromCandles(sliced, "prompt");
}

/**
 * Pick the closed-candle slice the copilot should analyze.
 * Default: visible chart range (+ pad). If the user named another range, widen
 * appropriately so the model can place points outside the viewport.
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
  const prompt = opts.prompt ?? "";
  const barSec = estimateBarSeconds(closedCandles);

  const expanded = prompt ? detectExpandedRangeIntent(prompt) : null;
  if (expanded) {
    const padSec = padBars * barSec;
    return selectForExpandedIntent(closedCandles, expanded, {
      visibleRange: opts.visibleRange,
      padSec,
      minBars,
      fallbackRecentBars,
    });
  }

  const tight = prompt ? promptRequestsVisibleWindow(prompt) : false;
  const bars = tight ? tightPadBars : padBars;
  const padSec = bars * barSec;

  const visible = opts.visibleRange;
  if (visible && Number.isFinite(visible.from) && Number.isFinite(visible.to) && visible.to > visible.from) {
    const fromBound = visible.from - padSec;
    const toBound = visible.to + padSec;
    const sliced = sliceByTimeBounds(closedCandles, fromBound, toBound);
    if (sliced.length >= minBars) {
      return windowFromCandles(sliced, "viewport");
    }
  }

  if (closedCandles.length > fallbackRecentBars) {
    return windowFromCandles(closedCandles.slice(-fallbackRecentBars), "recent");
  }

  return windowFromCandles(closedCandles, "all");
}

/** Annotate the user prompt so the model knows the primary analysis window. */
export function annotatePromptWithWindow(prompt: string, window: AnalysisWindow): string {
  let focus: string;
  if (window.mode === "prompt") {
    focus =
      "The user named another analysis/draw range — use this candle set for that range " +
      "(viewport is only the default when they did not). Draw point.time values inside this set";
  } else if (window.mode === "viewport") {
    focus = promptRequestsVisibleWindow(prompt)
      ? "Focus strictly on this visible chart window"
      : "Primary analysis window is the visible chart range (plus a small pad)";
  } else if (window.mode === "recent") {
    focus = "Primary analysis window is the most recent closed candles";
  } else if (detectExpandedRangeIntent(prompt)?.kind === "all") {
    focus =
      "The user asked for full/loaded history — use this entire closed-candle set; " +
      "viewport is only the default when they did not name another range";
  } else {
    focus = "Primary analysis window is the provided closed-candle set";
  }

  const drawHint =
    window.mode === "prompt" || detectExpandedRangeIntent(prompt)?.kind === "all"
      ? `All PatternShape point.time values MUST fall inside this candle set. ` +
        `Draw on the user-named range; do not restrict to the chart viewport.`
      : `All PatternShape point.time values MUST fall inside this candle set. ` +
        `Prefer patterns in the most recent / visible portion unless the user named another range.`;

  return (
    `${prompt}\n\n` +
    `[Analysis window] ${focus}: from=${window.from} to=${window.to} ` +
    `(${window.candles.length} closed candles, mode=${window.mode}). ` +
    drawHint
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
