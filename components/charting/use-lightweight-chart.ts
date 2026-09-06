import { useEffect, useMemo, useRef } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers, type UTCTimestamp } from "lightweight-charts";

import { chartTimestamp } from "@/components/charting/format";
import { AnnotationPrimitiveManager } from "@/components/charting/primitives/annotation-primitive-manager";
import type { AnnotationTheme } from "@/components/charting/primitives/annotation-styles";
import { useColors } from "@/hooks/use-colors";
import { flattenAnnotationsForRender, type ChartAnnotation, type ChartCandle, type ChartSignalMarker } from "@/shared/chart-types";

type UseLightweightChartOptions = {
  host: HTMLDivElement | null;
  candles: ChartCandle[];
  signals: ChartSignalMarker[];
  annotations?: ChartAnnotation[];
  annotationTheme: AnnotationTheme;
  showEma: boolean;
  showRsi: boolean;
  showMacd: boolean;
  onInspect: (candle: ChartCandle | null) => void;
};

export function useLightweightChart({ host, candles, signals, annotations, annotationTheme, showEma, showRsi, showMacd, onInspect }: UseLightweightChartOptions) {
  const colors = useColors();
  const managerRef = useRef(new AnnotationPrimitiveManager());
  const renderableAnnotations = useMemo(() => flattenAnnotationsForRender(annotations), [annotations]);

  useEffect(() => {
    if (!host || !candles.length) return;

    const manager = managerRef.current;
    const ordered = candles;
    const candleLookup = new Map(ordered.map((candle) => [chartTimestamp(candle.candleCloseTime), candle]));
    const chart = createChart(host, {
      autoSize: true,
      height: 432,
      layout: { attributionLogo: true, background: { type: ColorType.Solid, color: colors.background }, textColor: colors.muted, fontSize: 11 },
      grid: { vertLines: { color: colors.border, visible: true }, horzLines: { color: colors.border, visible: true } },
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    });
    chart.panes()[0]?.setStretchFactor(3);

    const candlesticks = chart.addSeries(CandlestickSeries, {
      upColor: colors.success,
      downColor: colors.error,
      borderUpColor: colors.success,
      borderDownColor: colors.error,
      wickUpColor: colors.success,
      wickDownColor: colors.error,
    });
    candlesticks.setData(ordered.map((candle) => ({
      time: chartTimestamp(candle.candleCloseTime),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })));

    const ema20 = chart.addSeries(LineSeries, { color: colors.primary, lineWidth: 2, title: "EMA 20", visible: showEma, crosshairMarkerVisible: false });
    const ema50 = chart.addSeries(LineSeries, { color: colors.warning, lineWidth: 2, title: "EMA 50", visible: showEma, crosshairMarkerVisible: false });
    ema20.setData(ordered.map((candle) => ({ time: chartTimestamp(candle.candleCloseTime), value: candle.ema20 })));
    ema50.setData(ordered.map((candle) => ({ time: chartTimestamp(candle.candleCloseTime), value: candle.ema50 })));

    const rsiPane = chart.addPane();
    rsiPane.setStretchFactor(showRsi ? 0.7 : 0.02);
    const rsi = rsiPane.addSeries(LineSeries, { color: colors.success, lineWidth: 2, title: "RSI 14", visible: showRsi, crosshairMarkerVisible: false });
    rsi.setData(ordered.map((candle) => ({ time: chartTimestamp(candle.candleCloseTime), value: candle.rsi14 })));
    rsi.createPriceLine({ price: 70, color: colors.warning, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    rsi.createPriceLine({ price: 30, color: colors.success, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });

    const macdPane = chart.addPane();
    macdPane.setStretchFactor(showMacd ? 0.7 : 0.02);
    const macd = macdPane.addSeries(LineSeries, { color: colors.primary, lineWidth: 2, title: "MACD", visible: showMacd, crosshairMarkerVisible: false });
    const signal = macdPane.addSeries(LineSeries, { color: colors.warning, lineWidth: 2, title: "Signal", visible: showMacd, crosshairMarkerVisible: false });
    const histogram = macdPane.addSeries(HistogramSeries, { title: "MACD histogram", visible: showMacd, priceFormat: { type: "price", precision: 4, minMove: 0.0001 } });
    macd.setData(ordered.map((candle) => ({ time: chartTimestamp(candle.candleCloseTime), value: candle.macd ?? 0 })));
    signal.setData(ordered.map((candle) => ({ time: chartTimestamp(candle.candleCloseTime), value: candle.macdSignal ?? 0 })));
    histogram.setData(ordered.map((candle) => {
      const value = (candle.macd ?? 0) - (candle.macdSignal ?? 0);
      return { time: chartTimestamp(candle.candleCloseTime), value, color: value >= 0 ? `${colors.success}99` : `${colors.error}99` };
    }));
    macd.createPriceLine({ price: 0, color: colors.border, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });

    createSeriesMarkers(candlesticks, signals.map((marker) => ({
      time: chartTimestamp(marker.candleCloseTime),
      position: marker.state === "BULLISH_SETUP" ? "belowBar" : marker.state === "BEARISH_SETUP" ? "aboveBar" : "inBar",
      color: marker.state === "BULLISH_SETUP" ? colors.success : marker.state === "BEARISH_SETUP" ? colors.error : colors.warning,
      shape: marker.state === "BULLISH_SETUP" ? "arrowUp" : marker.state === "BEARISH_SETUP" ? "arrowDown" : "circle",
      text: `${marker.state.replace("_SETUP", "")} · ${Math.round(Math.abs(marker.score) * 100)}%`,
    })));

    manager.sync(candlesticks, renderableAnnotations, annotationTheme);

    chart.timeScale().fitContent();

    const onCrosshairMove = (event: { time?: unknown }) => {
      const candle = typeof event.time === "number" ? candleLookup.get(event.time as UTCTimestamp) : undefined;
      onInspect(candle ?? null);
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    return () => {
      manager.detachAll(candlesticks);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
    };
  }, [annotationTheme, candles, colors, host, onInspect, renderableAnnotations, showEma, showMacd, showRsi, signals]);
}
