"use client";

import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ChartCoordinateApi } from "../lib/chart-api";
import { CHART_THEME } from "../lib/chart-theme";
import { mapAgentMarkersToSeriesMarkers } from "../lib/marker-map";
import { toVolumeData } from "../lib/volume-map";
import { useChartStore } from "../lib/stores/chart-store";
import { useMarkerStore } from "../lib/stores/marker-store";
import { ShapeOverlay } from "./shape-overlay";

type ChartCanvasProps = {
  coordApiRef: MutableRefObject<ChartCoordinateApi | null>;
};

function toCandleData(candles: { time: number; open: number; high: number; low: number; close: number }[]): CandlestickData[] {
  return candles.map((c) => ({
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function toHistogramData(candles: Parameters<typeof toVolumeData>[0]): HistogramData[] {
  return toVolumeData(candles).map((bar) => ({
    time: bar.time as UTCTimestamp,
    value: bar.value,
    color: bar.color,
  }));
}

function toSeriesMarkers(markers: ReturnType<typeof mapAgentMarkersToSeriesMarkers>): SeriesMarker<UTCTimestamp>[] {
  return markers.map((m) => ({
    ...m,
    time: m.time as UTCTimestamp,
  }));
}

export function ChartCanvas({ coordApiRef }: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayBoxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersApiRef = useRef<{
    setMarkers: (markers: SeriesMarker<UTCTimestamp>[]) => void;
  } | null>(null);
  const lastDataRef = useRef<CandlestickData[]>([]);
  const [overlayTick, setOverlayTick] = useState(0);

  const candles = useChartStore((s) => s.candles);
  const tickerPercent = useChartStore((s) => s.tickerPercent);
  const connection = useChartStore((s) => s.connection);
  const symbol = useChartStore((s) => s.symbol);
  const markers = useMarkerStore((s) => s.markers);


  const last = candles.length > 0 ? candles[candles.length - 1]! : null;
  const pct = tickerPercent;
  const pctPositive = pct != null && pct >= 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { color: CHART_THEME.background },
        textColor: CHART_THEME.muted,
        fontFamily: "var(--font-plex-mono), 'IBM Plex Mono', monospace",
      },
      grid: {
        vertLines: { color: `${CHART_THEME.line}44` },
        horzLines: { color: `${CHART_THEME.line}44` },
      },
      rightPriceScale: { borderColor: CHART_THEME.line },
      timeScale: { borderColor: CHART_THEME.line, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      width: el.clientWidth,
      height: el.clientHeight,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: CHART_THEME.green,
      downColor: CHART_THEME.red,
      borderUpColor: CHART_THEME.green,
      borderDownColor: CHART_THEME.red,
      wickUpColor: CHART_THEME.green,
      wickDownColor: CHART_THEME.red,
    });

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes[1]?.setStretchFactor(1);

    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volumeSeries;
    markersApiRef.current = createSeriesMarkers(series, []);

    const rebuildApi = () => {
      const s = seriesRef.current;
      const c = chartRef.current;
      if (!s || !c) {
        coordApiRef.current = null;
        return;
      }
      coordApiRef.current = {
        timeToCoordinate: (time) => {
          const v = c.timeScale().timeToCoordinate(time as UTCTimestamp);
          return v == null ? null : Number(v);
        },
        priceToCoordinate: (price) => {
          const v = s.priceToCoordinate(price);
          return v == null ? null : Number(v);
        },
        coordinateToTime: (x) => {
          const v = c.timeScale().coordinateToTime(x);
          if (v == null) return null;
          if (typeof v === "number") return v;
          if (typeof v === "object" && "year" in v) {
            return Math.floor(Date.UTC(v.year, v.month - 1, v.day) / 1000);
          }
          return null;
        },
        coordinateToPrice: (y) => {
          const v = s.coordinateToPrice(y);
          return v == null ? null : Number(v);
        },
      };
      const pane = c.paneSize(0);
      if (overlayBoxRef.current) {
        overlayBoxRef.current.style.height = `${pane.height}px`;
      }
      setOverlayTick((n) => n + 1);
    };

    const onRange = () => rebuildApi();
    const onSize = () => rebuildApi();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chart.timeScale().subscribeSizeChange(onSize);

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
      rebuildApi();
    });
    ro.observe(el);
    rebuildApi();

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.timeScale().unsubscribeSizeChange(onSize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      markersApiRef.current = null;
      coordApiRef.current = null;
      lastDataRef.current = [];
    };
  }, [coordApiRef]);

  useEffect(() => {
    const series = seriesRef.current;
    const volume = volumeRef.current;
    if (!series || !volume) return;

    const mapped = toCandleData(candles);
    const volumeMapped = toHistogramData(candles);
    if (mapped.length === 0) {
      series.setData([]);
      volume.setData([]);
      lastDataRef.current = [];
      setOverlayTick((n) => n + 1);
      return;
    }

    const prev = lastDataRef.current;
    const lastMapped = mapped[mapped.length - 1]!;
    const prevLast = prev[prev.length - 1];
    const lastVol = volumeMapped[volumeMapped.length - 1]!;

    const sameSeries =
      prev.length > 0 &&
      mapped.length > 0 &&
      prev[0]?.time === mapped[0]?.time &&
      (mapped.length === prev.length || mapped.length === prev.length + 1);

    if (sameSeries && prevLast && lastMapped.time === prevLast.time && mapped.length === prev.length) {
      series.update(lastMapped);
      volume.update(lastVol);
    } else if (sameSeries && mapped.length === prev.length + 1) {
      series.update(lastMapped);
      volume.update(lastVol);
    } else {
      series.setData(mapped);
      volume.setData(volumeMapped);
    }

    lastDataRef.current = mapped;
    setOverlayTick((n) => n + 1);
  }, [candles]);

  useEffect(() => {
    markersApiRef.current?.setMarkers(toSeriesMarkers(mapAgentMarkersToSeriesMarkers(markers)));
  }, [markers, overlayTick]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#161a25]">
      <div className="flex h-8 flex-none items-center justify-between border-b border-[#2b313a] bg-[#181a20] px-3 text-xs text-[#848e9c]">
        <div className="flex items-center gap-3 font-[family-name:var(--font-plex-mono)]">
          <span>
            O: <strong className="text-white">{last ? last.open.toFixed(2) : "—"}</strong>
          </span>
          <span>
            H: <strong className="text-white">{last ? last.high.toFixed(2) : "—"}</strong>
          </span>
          <span>
            L: <strong className="text-white">{last ? last.low.toFixed(2) : "—"}</strong>
          </span>
          <span>
            C:{" "}
            <strong className={pctPositive ? "text-[#0ecb81]" : "text-[#f6465d]"}>
              {last ? last.close.toFixed(2) : "—"}
            </strong>
          </span>
          {pct != null && (
            <span className={pctPositive ? "text-[#0ecb81]" : "text-[#f6465d]"}>
              {pctPositive ? "+" : ""}
              {pct.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="font-[family-name:var(--font-plex-mono)] text-[11px]">
          {symbol} · {connection}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        <div ref={overlayBoxRef} className="pointer-events-none absolute inset-x-0 top-0">
          <ShapeOverlay coordApiRef={coordApiRef} overlayTick={overlayTick} />
        </div>
      </div>
    </div>
  );
}
