import type { ISeriesApi, ISeriesPrimitive, Time } from "lightweight-charts";

import type { RenderableChartAnnotation } from "@/shared/chart-types";

import { type AnnotationTheme } from "./annotation-styles";
import { createHorizontalLevelPrimitive } from "./horizontal-level-primitive";
import { createTrendlinePrimitive } from "./trendline-primitive";
import { createZonePrimitive } from "./zone-primitive";

function createPrimitiveForAnnotation(annotation: RenderableChartAnnotation, theme: AnnotationTheme): ISeriesPrimitive<Time> {
  switch (annotation.kind) {
    case "HORIZONTAL_LEVEL":
      return createHorizontalLevelPrimitive(annotation, theme);
    case "TRENDLINE":
      return createTrendlinePrimitive(annotation, theme);
    case "ZONE":
      return createZonePrimitive(annotation, theme);
    default: {
      const _exhaustive: never = annotation;
      return _exhaustive;
    }
  }
}

export class AnnotationPrimitiveManager {
  private readonly attached: ISeriesPrimitive<Time>[] = [];
  private series: ISeriesApi<"Candlestick", Time> | null = null;

  sync(series: ISeriesApi<"Candlestick", Time>, annotations: RenderableChartAnnotation[], theme: AnnotationTheme): void {
    this.detachAll(series);
    this.series = series;
    for (const annotation of annotations) {
      const primitive = createPrimitiveForAnnotation(annotation, theme);
      series.attachPrimitive(primitive);
      this.attached.push(primitive);
    }
  }

  detachAll(series?: ISeriesApi<"Candlestick", Time>): void {
    const target = series ?? this.series;
    if (!target) return;
    for (const primitive of this.attached) {
      target.detachPrimitive(primitive);
    }
    this.attached.length = 0;
  }
}
