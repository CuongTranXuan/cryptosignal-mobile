import { describe, expect, it } from "vitest";
import type { PatternShape } from "../lib/pattern-shape";
import { mapShapeToPixels, mapZoneToRect, pixelsToPoint } from "../lib/overlay-map";

const shape: PatternShape = {
  id: "poly-1",
  symbol: "BTCUSDT",
  interval: "1h",
  kind: "polyline",
  name: "Triangle",
  status: "committed",
  source: "agent",
  confidence: 0.9,
  points: [
    { time: 10, price: 100 },
    { time: 20, price: 200 },
    { time: 30, price: 150 },
  ],
  priceLow: null,
  priceHigh: null,
};

const forwardApi = {
  timeToCoordinate: (t: number) => t * 2,
  priceToCoordinate: (p: number) => 1000 - p,
};

const inverseApi = {
  coordinateToTime: (x: number) => x / 2,
  coordinateToPrice: (y: number) => 1000 - y,
};

describe("overlay-map", () => {
  it("maps three points to fake pixel coordinates", () => {
    const pixels = mapShapeToPixels(shape, forwardApi);

    expect(pixels).toEqual([
      { x: 20, y: 900 },
      { x: 40, y: 800 },
      { x: 60, y: 850 },
    ]);
  });

  it("pixelsToPoint inverts coordinates and returns null when either is null", () => {
    expect(pixelsToPoint(20, 900, inverseApi)).toEqual({ time: 10, price: 100 });

    expect(
      pixelsToPoint(20, 900, {
        coordinateToTime: () => null,
        coordinateToPrice: (y) => 1000 - y,
      }),
    ).toBeNull();

    expect(
      pixelsToPoint(20, 900, {
        coordinateToTime: (x) => x / 2,
        coordinateToPrice: () => null,
      }),
    ).toBeNull();
  });

  it("mapShapeToPixels drops points with null coordinates", () => {
    const pixels = mapShapeToPixels(shape, {
      timeToCoordinate: (t) => (t === 20 ? null : t * 2),
      priceToCoordinate: (p) => 1000 - p,
    });

    expect(pixels).toEqual([
      { x: 20, y: 900 },
      { x: 60, y: 850 },
    ]);
  });

  it("maps horizontal trendline (equal price) to a flat segment", () => {
    const horizontal: PatternShape = {
      ...shape,
      id: "fib-level",
      kind: "trendline",
      name: "0.618",
      points: [
        { time: 10, price: 150 },
        { time: 40, price: 150 },
      ],
    };
    const pixels = mapShapeToPixels(horizontal, forwardApi);
    expect(pixels).toEqual([
      { x: 20, y: 850 },
      { x: 80, y: 850 },
    ]);
  });

  it("mapZoneToRect uses partial time coords when one bound extrapolates", () => {
    const zone: PatternShape = {
      ...shape,
      id: "zone-future",
      kind: "zone",
      points: [
        { time: 10, price: 100 },
        { time: 50, price: 100 },
      ],
      priceLow: 90,
      priceHigh: 110,
    };
    const api = {
      timeToCoordinate: (t: number) => (t <= 30 ? t * 2 : 60 + (t - 30) * 2),
      priceToCoordinate: forwardApi.priceToCoordinate,
    };
    expect(mapZoneToRect(zone, api, 800)).toEqual({
      x: 20,
      y: 890,
      width: 80,
      height: 20,
    });
  });

  it("mapZoneToRect maps priceLow/priceHigh and time bounds", () => {
    const zone: PatternShape = {
      ...shape,
      id: "zone-1",
      kind: "zone",
      name: "Support",
      points: [
        { time: 10, price: 100 },
        { time: 30, price: 100 },
      ],
      priceLow: 90,
      priceHigh: 110,
    };

    expect(mapZoneToRect(zone, forwardApi, 800)).toEqual({
      x: 20,
      y: 890,
      width: 40,
      height: 20,
    });
  });
});
