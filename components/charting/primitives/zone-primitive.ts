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
import type { ZoneAnnotation } from "@/shared/chart-types";

import { colorForTone, toneFromLabel, withAlpha, type AnnotationTheme } from "./annotation-styles";

class ZonePaneRenderer implements IPrimitivePaneRenderer {
  private left = 0;
  private top = 0;
  private width = 0;
  private height = 0;
  private visible = false;
  private fill = "rgba(128,128,128,0.2)";
  private stroke = "#888888";
  private dashed = false;

  update(box: { left: number; top: number; width: number; height: number } | null, fill: string, stroke: string, dashed: boolean) {
    if (!box || box.width <= 0 || box.height <= 0) {
      this.visible = false;
      return;
    }
    this.left = box.left;
    this.top = box.top;
    this.width = box.width;
    this.height = box.height;
    this.fill = fill;
    this.stroke = stroke;
    this.dashed = dashed;
    this.visible = true;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (!this.visible) return;
    target.useBitmapCoordinateSpace(({ context }) => {
      context.fillStyle = this.fill;
      context.strokeStyle = this.stroke;
      context.lineWidth = 1;
      if (this.dashed) context.setLineDash([6, 4]);
      context.fillRect(this.left, this.top, this.width, this.height);
      context.strokeRect(this.left, this.top, this.width, this.height);
      context.setLineDash([]);
    });
  }
}

class ZonePaneView implements IPrimitivePaneView {
  private readonly paneRenderer = new ZonePaneRenderer();

  constructor(private readonly source: ZonePrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    return this.paneRenderer;
  }

  update() {
    const series = this.source.series;
    const chart = this.source.chart;
    if (!series || !chart) {
      this.paneRenderer.update(null, this.source.fill, this.source.stroke, this.source.dashed);
      return;
    }
    const x1 = chart.timeScale().timeToCoordinate(chartTimestamp(this.source.annotation.startTime));
    const x2 = chart.timeScale().timeToCoordinate(chartTimestamp(this.source.annotation.endTime));
    const yTop = series.priceToCoordinate(this.source.annotation.topPrice);
    const yBottom = series.priceToCoordinate(this.source.annotation.bottomPrice);
    if (x1 === null || x2 === null || yTop === null || yBottom === null) {
      this.paneRenderer.update(null, this.source.fill, this.source.stroke, this.source.dashed);
      return;
    }
    const left = Math.min(x1, x2);
    const width = Math.abs(x2 - x1);
    const top = Math.min(yTop, yBottom);
    const height = Math.abs(yBottom - yTop);
    this.paneRenderer.update({ left, top, width, height }, this.source.fill, this.source.stroke, this.source.dashed);
  }
}

export class ZonePrimitive implements ISeriesPrimitive<Time> {
  private readonly paneView = new ZonePaneView(this);
  series: ISeriesApi<"Candlestick", Time> | null = null;
  chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;

  constructor(
    readonly annotation: ZoneAnnotation,
    readonly fill: string,
    readonly stroke: string,
    readonly dashed: boolean,
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

export function createZonePrimitive(annotation: ZoneAnnotation, theme: AnnotationTheme): ZonePrimitive {
  const tone = toneFromLabel(annotation.label);
  const stroke = colorForTone(theme, tone);
  const fill = withAlpha(stroke, annotation.label === "INVALIDATION" ? 0.18 : 0.35);
  return new ZonePrimitive(annotation, fill, stroke, annotation.label === "INVALIDATION");
}
