import type { ChartCandleInput } from "./chart-utils";

/** Completed-candle history used by the research chart. */
export type ChartCandle = ChartCandleInput & {
  macd?: number;
  macdSignal?: number;
};

/** Closed-candle signal marker rendered on the chart time axis. */
export type ChartSignalMarker = {
  candleCloseTime: string | Date;
  state: string;
  score: number;
};

/** Distinguishes confirmed history from live, unconfirmed overlays. */
export type ChartDataQuality = "CLOSED_CANDLE" | "LIVE_UNCONFIRMED";

/** Extensible annotation kinds for the chart platform. */
export type ChartAnnotationKind =
  | "HORIZONTAL_LEVEL"
  | "TRENDLINE"
  | "ZONE"
  | "SIGNAL_MARKER"
  | "METHODOLOGY_OVERLAY";

export type ChartAnnotationBase = {
  id: string;
  kind: ChartAnnotationKind;
  assetSymbol: string;
  timeframe: string;
  createdAt: string;
  dataQuality: ChartDataQuality;
};

export type HorizontalLevelAnnotation = ChartAnnotationBase & {
  kind: "HORIZONTAL_LEVEL";
  price: number;
  label?: string;
};

/** Reserved for Phase 2+ drawing tools. */
export type TrendlineAnnotation = ChartAnnotationBase & {
  kind: "TRENDLINE";
  startTime: string;
  startPrice: number;
  endTime: string;
  endPrice: number;
  label?: string;
};

export type ZoneAnnotation = ChartAnnotationBase & {
  kind: "ZONE";
  topPrice: number;
  bottomPrice: number;
  startTime: string;
  endTime: string;
  label?: string;
};

export type ChartAnnotation = HorizontalLevelAnnotation | TrendlineAnnotation | ZoneAnnotation;

export type ResearchChartPanelProps = {
  candles: ChartCandle[];
  signals: ChartSignalMarker[];
  assetSymbol?: string;
  timeframe?: string;
  dataQuality?: ChartDataQuality;
  /** Persisted or agent-authored annotations; horizontal levels are the first supported kind. */
  annotations?: ChartAnnotation[];
  onAnnotationsChange?: (annotations: ChartAnnotation[]) => void;
};
