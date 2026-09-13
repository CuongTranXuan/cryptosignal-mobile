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
