export type VisibleTimeRange = { from: number; to: number };

export type ChartCoordinateApi = {
  timeToCoordinate: (time: number) => number | null;
  priceToCoordinate: (price: number) => number | null;
  coordinateToTime: (x: number) => number | null;
  coordinateToPrice: (y: number) => number | null;
  /** Scroll/zoom so these unix-second times fall inside the visible window. */
  revealTimes: (times: number[]) => void;
  /** Current visible time range on the chart, or null if not ready. */
  getVisibleTimeRange: () => VisibleTimeRange | null;
};
