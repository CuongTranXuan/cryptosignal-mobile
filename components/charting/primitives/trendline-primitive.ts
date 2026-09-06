import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";

import { chartTimestamp } from "@/components/charting/format";
import type { TrendlineAnnotation } from "@/shared/chart-types";

import { colorForTone, toneFromLabel, type AnnotationTheme } from "./annotation-styles";

class TrendlinePaneRenderer implements IPrimitivePaneRenderer {
  private x1 = 0;
  private y1 = 0;
  private x2 = 0;
  private y2 = 0;
  private visible = false;
  private color = "#888888";

  update(points: { x1: number; y1: number; x2: number; y2: number } | null, color: string) {
    if (!points) {
      this.visible = false;
      return;
    }
    this.x1 = points.x1;
    this.y1 = points.y1;
    this.x2 = points.x2;
    this.y2 = points.y2;
    this.color = color;
    this.visible = true;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (!this.visible) return;
    target.useBitmapCoordinateSpace(({ context }) => {
      context.beginPath();
      context.strokeStyle = this.color;
      context.lineWidth = 1;
      context.moveTo(this.x1, this.y1);
      context.lineTo(this.x2, this.y2);
      context.stroke();
    });
  }
}

class TrendlinePaneView implements IPrimitivePaneView {
  private readonly paneRenderer = new TrendlinePaneRenderer();

  constructor(private readonly source: TrendlinePrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    return this.paneRenderer;
  }

  update() {
    const series = this.source.series;
    const chart = this.source.chart;
    if (!series || !chart) {
      this.paneRenderer.update(null, this.source.color);
      return;
    }
    const x1 = chart.timeScale().timeToCoordinate(chartTimestamp(this.source.annotation.startTime));
    const x2 = chart.timeScale().timeToCoordinate(chartTimestamp(this.source.annotation.endTime));
    const y1 = series.priceToCoordinate(this.source.annotation.startPrice);
    const y2 = series.priceToCoordinate(this.source.annotation.endPrice);
    if (x1 === null || x2 === null || y1 === null || y2 === null) {
      this.paneRenderer.update(null, this.source.color);
      return;
    }
    this.paneRenderer.update({ x1, y1, x2, y2 }, this.source.color);
  }
}

export class TrendlinePrimitive implements ISeriesPrimitive<Time> {
  private readonly paneView = new TrendlinePaneView(this);
  series: ISeriesApi<"Candlestick", Time> | null = null;
  chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;

  constructor(
    readonly annotation: TrendlineAnnotation,
    readonly color: string,
  ) {}

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series as ISeriesApi<"Candlestick", Time>;
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
  }

  updateAllViews(): void {
    this.paneView.update();
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }
}

export function createTrendlinePrimitive(annotation: TrendlineAnnotation, theme: AnnotationTheme): TrendlinePrimitive {
  const tone = toneFromLabel(annotation.label);
  return new TrendlinePrimitive(annotation, colorForTone(theme, tone));
}
