import type { PatternShape } from "./pattern-shape";

export type ForwardCoordinateApi = {
  timeToCoordinate: (time: number) => number | null;
  priceToCoordinate: (price: number) => number | null;
};

export type InverseCoordinateApi = {
  coordinateToTime: (x: number) => number | null;
  coordinateToPrice: (y: number) => number | null;
};

export type PixelPoint = { x: number; y: number };

export function mapShapeToPixels(
  shape: PatternShape,
  api: ForwardCoordinateApi,
): PixelPoint[] {
  const pixels: PixelPoint[] = [];
  for (const point of shape.points) {
    const x = api.timeToCoordinate(point.time);
    const y = api.priceToCoordinate(point.price);
    if (x == null || y == null) continue;
    pixels.push({ x, y });
  }
  return pixels;
}

export function pixelsToPoint(
  x: number,
  y: number,
  api: InverseCoordinateApi,
): { time: number; price: number } | null {
  const time = api.coordinateToTime(x);
  const price = api.coordinateToPrice(y);
  if (time == null || price == null) return null;
  return { time, price };
}

export type ZoneRect = { x: number; y: number; width: number; height: number };

export function mapZoneToRect(
  shape: PatternShape,
  api: ForwardCoordinateApi,
  paneWidth: number,
): ZoneRect | null {
  if (shape.priceLow == null || shape.priceHigh == null) return null;
  const yHigh = api.priceToCoordinate(shape.priceHigh);
  const yLow = api.priceToCoordinate(shape.priceLow);
  if (yHigh == null || yLow == null) return null;

  let x1 = 0;
  let x2 = paneWidth;
  if (shape.points.length >= 2) {
    const times = shape.points.map((p) => p.time);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const cx1 = api.timeToCoordinate(minT);
    const cx2 = api.timeToCoordinate(maxT);
    if (cx1 != null && cx2 != null) {
      x1 = Math.min(cx1, cx2);
      x2 = Math.max(cx1, cx2);
    }
  }

  const y = Math.min(yHigh, yLow);
  return {
    x: x1,
    y,
    width: Math.max(0, x2 - x1),
    height: Math.abs(yLow - yHigh),
  };
}
