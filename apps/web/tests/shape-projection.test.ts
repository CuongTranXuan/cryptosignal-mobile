import { describe, expect, it } from "vitest";
import type { PatternShape } from "../lib/pattern-shape";
import {
  filterShapesWithProjection,
  isOnProjectionGrid,
  maxProjectedTime,
  shapePointTimesAllowed,
  timeToCoordinateWithProjection,
} from "../lib/shape-projection";

function candle(time: number) {
  return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
}

function baseShape(overrides: Partial<PatternShape> = {}): PatternShape {
  return {
    id: "s1",
    symbol: "BTCUSDT",
    interval: "1h",
    kind: "trendline",
    name: "Ray",
    status: "preview",
    source: "agent",
    confidence: 0.8,
    points: [
      { time: 1000, price: 50 },
      { time: 4600, price: 60 },
    ],
    priceLow: null,
    priceHigh: null,
    ...overrides,
  };
}

describe("shape-projection", () => {
  const allowed = new Set([1000, 4600, 8200]);
  const lastClosed = 8200;
  const barSec = 3600;
  const closed = [candle(1000), candle(4600), candle(8200)];

  it("caps max projected time by interval", () => {
    expect(maxProjectedTime(3000, 3600, "1h")).toBe(3000 + 24 * 3600);
    expect(maxProjectedTime(3000, 60, "1m")).toBe(3000 + 30 * 60);
    expect(maxProjectedTime(3000, 86400, "1d")).toBe(3000 + 12 * 86400);
  });

  it("requires future times on the projection grid", () => {
    expect(isOnProjectionGrid(lastClosed + barSec, lastClosed, barSec)).toBe(true);
    expect(isOnProjectionGrid(lastClosed + barSec + 500, lastClosed, barSec)).toBe(false);
  });

  it("allows one forward agent endpoint on the grid", () => {
    expect(
      shapePointTimesAllowed(
        baseShape({ points: [{ time: 4600, price: 1 }, { time: lastClosed + barSec, price: 2 }] }),
        allowed,
        lastClosed,
        barSec,
        "1h",
      ),
    ).toBe(true);
  });

  it("rejects multiple future points or non-forward future point", () => {
    expect(
      shapePointTimesAllowed(
        baseShape({
          points: [
            { time: 6600, price: 1 },
            { time: 10200, price: 2 },
          ],
        }),
        allowed,
        lastClosed,
        barSec,
        "1h",
      ),
    ).toBe(false);

    expect(
      shapePointTimesAllowed(
        baseShape({
          kind: "polyline",
          points: [
            { time: 1000, price: 1 },
            { time: lastClosed + barSec, price: 2 },
            { time: lastClosed + 2 * barSec, price: 3 },
          ],
        }),
        allowed,
        lastClosed,
        barSec,
        "1h",
      ),
    ).toBe(false);
  });

  it("rejects future points beyond k cap", () => {
    const tooFar = lastClosed + 25 * barSec;
    expect(
      shapePointTimesAllowed(
        baseShape({ points: [{ time: 1000, price: 1 }, { time: tooFar, price: 2 }] }),
        allowed,
        lastClosed,
        barSec,
        "1h",
      ),
    ).toBe(false);
  });

  it("rejects human shapes with future times", () => {
    expect(
      shapePointTimesAllowed(
        baseShape({
          source: "human",
          points: [{ time: 1000, price: 1 }, { time: 6600, price: 2 }],
        }),
        allowed,
        lastClosed,
        barSec,
        "1h",
      ),
    ).toBe(false);
  });

  it("filterShapesWithProjection keeps in-history and valid rays", () => {
    const hist = baseShape({ id: "hist", points: [{ time: 1000, price: 1 }, { time: 4600, price: 2 }] });
    const ray = baseShape({
      id: "ray",
      points: [{ time: 4600, price: 1 }, { time: lastClosed + barSec, price: 2 }],
    });
    const bad = baseShape({ id: "bad", points: [{ time: 1000, price: 1 }, { time: 999999, price: 2 }] });
    const { valid, droppedIds } = filterShapesWithProjection(
      [hist, ray, bad],
      allowed,
      closed,
      "1h",
    );
    expect(valid.map((s) => s.id)).toEqual(["hist", "ray"]);
    expect(droppedIds).toEqual(["bad"]);
  });

  it("extrapolates x for times after the last candle", () => {
    const candles = [candle(0), candle(3600), candle(7200)];
    const raw = (t: number) => (t <= 7200 ? t / 10 : null);
    expect(timeToCoordinateWithProjection(10800, raw, candles)).toBe(720 + 360);
  });
});
