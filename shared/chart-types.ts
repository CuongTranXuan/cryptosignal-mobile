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

export type ChartAnnotationSource = "ENGINE" | "AGENT" | "DASHBOARD" | "SYSTEM";

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
  source?: ChartAnnotationSource;
  label?: string;
};

export type HorizontalLevelAnnotation = ChartAnnotationBase & {
  kind: "HORIZONTAL_LEVEL";
  price: number;
};

export type TrendlineAnnotation = ChartAnnotationBase & {
  kind: "TRENDLINE";
  startTime: string;
  startPrice: number;
  endTime: string;
  endPrice: number;
};

export type ZoneAnnotation = ChartAnnotationBase & {
  kind: "ZONE";
  topPrice: number;
  bottomPrice: number;
  startTime: string;
  endTime: string;
};

export type MethodologyOverlayAnnotation = ChartAnnotationBase & {
  kind: "METHODOLOGY_OVERLAY";
  source: ChartAnnotationSource;
  ruleId: string;
  ruleFamily: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  sourceFindingId: string;
  overlayShape: "HORIZONTAL_LEVEL" | "TRENDLINE" | "ZONE";
  geometry: HorizontalLevelAnnotation | TrendlineAnnotation | ZoneAnnotation;
};

export type ChartAnnotation =
  | HorizontalLevelAnnotation
  | TrendlineAnnotation
  | ZoneAnnotation
  | MethodologyOverlayAnnotation;

/** Concrete shapes passed to LWC primitives after expanding methodology overlays. */
export type RenderableChartAnnotation = HorizontalLevelAnnotation | TrendlineAnnotation | ZoneAnnotation;

const MAX_RENDERABLE_ANNOTATIONS = 20;

export function flattenAnnotationsForRender(annotations: ChartAnnotation[] | undefined): RenderableChartAnnotation[] {
  if (!annotations?.length) return [];
  const flat: RenderableChartAnnotation[] = [];
  for (const annotation of annotations) {
    if (annotation.kind === "METHODOLOGY_OVERLAY") {
      flat.push(annotation.geometry);
      continue;
    }
    flat.push(annotation);
  }
  return flat.slice(0, MAX_RENDERABLE_ANNOTATIONS);
}

export type ResearchChartPanelProps = {
  candles: ChartCandle[];
  signals: ChartSignalMarker[];
  assetSymbol?: string;
  timeframe?: string;
  dataQuality?: ChartDataQuality;
  annotations?: ChartAnnotation[];
};
