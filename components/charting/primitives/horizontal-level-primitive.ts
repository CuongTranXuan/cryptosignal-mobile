import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";

import type { HorizontalLevelAnnotation } from "@/shared/chart-types";

import { colorForTone, toneFromLabel, type AnnotationTheme } from "./annotation-styles";

class HorizontalLevelPaneRenderer implements IPrimitivePaneRenderer {
  private y: number | null = null;
  private color = "#888888";

  update(y: number | null, color: string) {
    this.y = y;
    this.color = color;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this.y === null) return;
    target.useBitmapCoordinateSpace(({ context, bitmapSize }) => {
      context.beginPath();
      context.strokeStyle = this.color;
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.moveTo(0, this.y!);
      context.lineTo(bitmapSize.width, this.y!);
      context.stroke();
      context.setLineDash([]);
    });
  }
}

class HorizontalLevelPaneView implements IPrimitivePaneView {
  private readonly paneRenderer = new HorizontalLevelPaneRenderer();

  constructor(private readonly source: HorizontalLevelPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    return this.paneRenderer;
  }

  update() {
    const series = this.source.series;
    if (!series) {
      this.paneRenderer.update(null, this.source.color);
      return;
    }
    const y = series.priceToCoordinate(this.source.annotation.price);
    this.paneRenderer.update(y, this.source.color);
  }
}

export class HorizontalLevelPrimitive implements ISeriesPrimitive<Time> {
  private readonly paneView = new HorizontalLevelPaneView(this);
  series: ISeriesApi<"Candlestick", Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  constructor(
    readonly annotation: HorizontalLevelAnnotation,
    readonly color: string,
  ) {}

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series as ISeriesApi<"Candlestick", Time>;
    this.requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this.series = null;
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

export function createHorizontalLevelPrimitive(annotation: HorizontalLevelAnnotation, theme: AnnotationTheme): HorizontalLevelPrimitive {
  const tone = toneFromLabel(annotation.label);
  return new HorizontalLevelPrimitive(annotation, colorForTone(theme, tone));
}
