import { estimateBarSeconds } from "./analysis-window";
import type { Candle, Interval, PatternShape } from "./pattern-shape";

export const HARD_MAX_PROJECTION_BARS = 48;

export function maxProjectionBarsForInterval(interval: Interval): number {
  switch (interval) {
    case "1m":
      return 30;
    case "15m":
    case "1h":
      return 24;
    case "4h":
      return 18;
    case "1d":
      return 12;
    default: {
      const unreachable: never = interval;
      return unreachable;
    }
  }
}

export function effectiveProjectionBars(interval: Interval): number {
  return Math.min(maxProjectionBarsForInterval(interval), HARD_MAX_PROJECTION_BARS);
}

export function maxProjectedTime(
  lastClosed: number,
  barSec: number,
  interval: Interval,
): number {
  const k = effectiveProjectionBars(interval);
  return lastClosed + k * barSec;
}

/** Future agent times must land on lastClosed + k×barSec (k ≥ 1). */
export function isOnProjectionGrid(
  time: number,
  lastClosed: number,
  barSec: number,
): boolean {
  if (time <= lastClosed) return true;
  if (barSec <= 0) return false;
  const k = (time - lastClosed) / barSec;
  const rounded = Math.round(k);
  return rounded >= 1 && Math.abs(k - rounded) < 1e-3;
}

export function lastClosedFromAllowedTimes(allowedTimes: Set<number>): number | null {
  if (allowedTimes.size === 0) return null;
  return Math.max(...allowedTimes);
}

/**
 * Agent shapes may place at most one forward endpoint after lastClosed, on the
 * projection grid and within interval k caps. Human shapes must use closed times only.
 */
export function shapePointTimesAllowed(
  shape: PatternShape,
  allowedTimes: Set<number>,
  lastClosed: number,
  barSec: number,
  interval: Interval,
): boolean {
  const points = shape.points;
  if (points.length === 0) return false;

  const maxProjected = maxProjectedTime(lastClosed, barSec, interval);
  const future = points.filter((p) => p.time > lastClosed);

  if (future.length === 0) {
    return points.every((p) => allowedTimes.has(p.time));
  }

  if (shape.source !== "agent") return false;
  if (future.length !== 1) return false;

  const forwardTime = Math.max(...points.map((p) => p.time));
  const futurePoint = future[0]!;
  if (futurePoint.time !== forwardTime) return false;

  for (const p of points) {
    if (p.time <= lastClosed && !allowedTimes.has(p.time)) return false;
  }

  if (!isOnProjectionGrid(futurePoint.time, lastClosed, barSec)) return false;
  if (futurePoint.time > maxProjected) return false;

  return true;
}

export function filterShapesWithProjection(
  shapes: PatternShape[],
  allowedTimes: Set<number>,
  closedCandles: Candle[],
  interval: Interval,
): { valid: PatternShape[]; droppedIds: string[] } {
  const lastClosed = lastClosedFromAllowedTimes(allowedTimes);
  if (lastClosed == null) {
    return { valid: [], droppedIds: shapes.map((s) => s.id) };
  }
  const barSec = estimateBarSeconds(closedCandles);
  const valid: PatternShape[] = [];
  const droppedIds: string[] = [];
  for (const shape of shapes) {
    if (shapePointTimesAllowed(shape, allowedTimes, lastClosed, barSec, interval)) {
      valid.push(shape);
    } else {
      droppedIds.push(shape.id);
    }
  }
  return { valid, droppedIds };
}

export type TimeToCoordFn = (time: number) => number | null;

/**
 * Map unix-second time to x, extrapolating past the last loaded candle when LWC
 * returns null (forward projection whitespace).
 */
export function timeToCoordinateWithProjection(
  time: number,
  rawTimeToCoordinate: TimeToCoordFn,
  candles: Candle[],
): number | null {
  const direct = rawTimeToCoordinate(time);
  if (direct != null) return direct;
  if (candles.length === 0) return null;

  const lastIdx = candles.length - 1;
  const lastTime = candles[lastIdx]!.time;
  if (time < lastTime) return null;

  const lastX = rawTimeToCoordinate(lastTime);
  if (lastX == null) return null;

  const prevTime =
    lastIdx > 0 ? candles[lastIdx - 1]!.time : lastTime - estimateBarSeconds(candles);
  const prevX = rawTimeToCoordinate(prevTime);
  if (prevX == null) return null;

  const barSec = prevTime < lastTime ? lastTime - prevTime : estimateBarSeconds(candles);
  if (barSec <= 0) return null;

  const barWidthPx = lastX - prevX;
  if (barWidthPx === 0) return null;

  const barsAhead = (time - lastTime) / barSec;
  return lastX + barsAhead * barWidthPx;
}
