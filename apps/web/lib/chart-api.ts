export type ChartCoordinateApi = {
  timeToCoordinate: (time: number) => number | null;
  priceToCoordinate: (price: number) => number | null;
  coordinateToTime: (x: number) => number | null;
  coordinateToPrice: (y: number) => number | null;
  /** Scroll/zoom so these unix-second times fall inside the visible window. */
  revealTimes: (times: number[]) => void;
};
