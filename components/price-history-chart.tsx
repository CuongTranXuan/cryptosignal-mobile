import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers, type UTCTimestamp } from "lightweight-charts";

import { useColors } from "@/hooks/use-colors";

type Candle = { candleCloseTime: string | Date; open: number; high: number; low: number; close: number; ema20: number; ema50: number; rsi14: number; macd?: number; macdSignal?: number };
type SignalMarker = { candleCloseTime: string | Date; state: string; score: number };
type Inspection = Candle & { label: string };

const timestamp = (value: string | Date) => Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
const price = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: value >= 1000 ? 2 : 5 });

/** Browser-only OHLCV chart. Pan/zoom/crosshair are native library tools; horizontal levels are local visual research aids. */
export function PriceHistoryChart({ candles, signals }: { candles: Candle[]; signals: SignalMarker[] }) {
  const colors = useColors();
  const chartHost = useRef<HTMLDivElement | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(true);
  const [levels, setLevels] = useState<number[]>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || !chartHost.current || !candles.length) return;
    const host = chartHost.current;
    const ordered = [...candles].sort((left, right) => new Date(left.candleCloseTime).getTime() - new Date(right.candleCloseTime).getTime());
    const candleLookup = new Map(ordered.map((candle) => [timestamp(candle.candleCloseTime), candle]));
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
    const candlesticks = chart.addSeries(CandlestickSeries, { upColor: colors.success, downColor: colors.error, borderUpColor: colors.success, borderDownColor: colors.error, wickUpColor: colors.success, wickDownColor: colors.error });
    candlesticks.setData(ordered.map((candle) => ({ time: timestamp(candle.candleCloseTime), open: candle.open, high: candle.high, low: candle.low, close: candle.close })));
    const ema20 = chart.addSeries(LineSeries, { color: colors.primary, lineWidth: 2, title: "EMA 20", visible: showEma, crosshairMarkerVisible: false });
    const ema50 = chart.addSeries(LineSeries, { color: colors.warning, lineWidth: 2, title: "EMA 50", visible: showEma, crosshairMarkerVisible: false });
    ema20.setData(ordered.map((candle) => ({ time: timestamp(candle.candleCloseTime), value: candle.ema20 })));
    ema50.setData(ordered.map((candle) => ({ time: timestamp(candle.candleCloseTime), value: candle.ema50 })));

    const rsiPane = chart.addPane();
    rsiPane.setStretchFactor(showRsi ? 0.7 : 0.02);
    const rsi = rsiPane.addSeries(LineSeries, { color: colors.success, lineWidth: 2, title: "RSI 14", visible: showRsi, crosshairMarkerVisible: false });
    rsi.setData(ordered.map((candle) => ({ time: timestamp(candle.candleCloseTime), value: candle.rsi14 })));
    rsi.createPriceLine({ price: 70, color: colors.warning, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    rsi.createPriceLine({ price: 30, color: colors.success, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });

    const macdPane = chart.addPane();
    macdPane.setStretchFactor(showMacd ? 0.7 : 0.02);
    const macd = macdPane.addSeries(LineSeries, { color: colors.primary, lineWidth: 2, title: "MACD", visible: showMacd, crosshairMarkerVisible: false });
    const signal = macdPane.addSeries(LineSeries, { color: colors.warning, lineWidth: 2, title: "Signal", visible: showMacd, crosshairMarkerVisible: false });
    const histogram = macdPane.addSeries(HistogramSeries, { title: "MACD histogram", visible: showMacd, priceFormat: { type: "price", precision: 4, minMove: 0.0001 } });
    macd.setData(ordered.map((candle) => ({ time: timestamp(candle.candleCloseTime), value: candle.macd ?? 0 })));
    signal.setData(ordered.map((candle) => ({ time: timestamp(candle.candleCloseTime), value: candle.macdSignal ?? 0 })));
    histogram.setData(ordered.map((candle) => { const value = (candle.macd ?? 0) - (candle.macdSignal ?? 0); return { time: timestamp(candle.candleCloseTime), value, color: value >= 0 ? `${colors.success}99` : `${colors.error}99` }; }));
    macd.createPriceLine({ price: 0, color: colors.border, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });

    createSeriesMarkers(candlesticks, signals.map((marker) => ({
      time: timestamp(marker.candleCloseTime),
      position: marker.state === "BULLISH_SETUP" ? "belowBar" : marker.state === "BEARISH_SETUP" ? "aboveBar" : "inBar",
      color: marker.state === "BULLISH_SETUP" ? colors.success : marker.state === "BEARISH_SETUP" ? colors.error : colors.warning,
      shape: marker.state === "BULLISH_SETUP" ? "arrowUp" : marker.state === "BEARISH_SETUP" ? "arrowDown" : "circle",
      text: `${marker.state.replace("_SETUP", "")} · ${Math.round(Math.abs(marker.score) * 100)}%`,
    })));
    levels.forEach((level, index) => candlesticks.createPriceLine({ price: level, color: colors.primary, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Level ${index + 1}` }));
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((event) => {
      const candle = typeof event.time === "number" ? candleLookup.get(event.time as UTCTimestamp) : undefined;
      setInspection(candle ? { ...candle, label: new Date(candle.candleCloseTime).toLocaleString() } : null);
    });
    return () => chart.remove();
  }, [candles, colors, levels, showEma, showMacd, showRsi, signals]);

  if (!candles.length) return null;
  if (Platform.OS !== "web") return <Text style={[styles.unsupported, { color: colors.muted }]}>Interactive charts are available in the browser dashboard.</Text>;
  const latest = inspection ?? { ...candles[candles.length - 1], label: new Date(candles[candles.length - 1].candleCloseTime).toLocaleString() };
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={styles.header}><View><Text style={[styles.price, { color: colors.foreground }]}>{price(latest.close)}</Text><Text style={[styles.meta, { color: colors.muted }]}>{latest.label} · closed candle</Text></View><View style={styles.toolRow}><Tool label="EMA" active={showEma} onPress={() => setShowEma((current) => !current)} colors={colors} /><Tool label="RSI" active={showRsi} onPress={() => setShowRsi((current) => !current)} colors={colors} /><Tool label="MACD" active={showMacd} onPress={() => setShowMacd((current) => !current)} colors={colors} /></View></View>
    <div ref={chartHost} style={{ width: "100%", minHeight: 432 }} aria-label="Interactive historical price chart with candlesticks, indicator overlays, and signal annotations" />
    <View style={styles.metrics}><Metric label="O" value={price(latest.open)} colors={colors} /><Metric label="H" value={price(latest.high)} colors={colors} /><Metric label="L" value={price(latest.low)} colors={colors} /><Metric label="C" value={price(latest.close)} colors={colors} /><Metric label="RSI" value={latest.rsi14.toFixed(1)} colors={colors} /><Metric label="MACD" value={(latest.macd ?? 0).toFixed(3)} colors={colors} /></View>
    <View style={styles.levelRow}><Pressable onPress={() => setLevels((current) => [...current, latest.close])} style={({ pressed }) => [styles.levelButton, { borderColor: colors.primary }, pressed && styles.pressed]}><Text style={[styles.levelText, { color: colors.primary }]}>Add close as level</Text></Pressable><Pressable disabled={!levels.length} onPress={() => setLevels([])} style={({ pressed }) => [styles.levelButton, { borderColor: colors.border }, pressed && styles.pressed, !levels.length && styles.disabled]}><Text style={[styles.levelText, { color: colors.muted }]}>Clear levels</Text></Pressable></View>
    <View style={styles.legend}><Legend color={colors.success} label="Bullish setup" colors={colors} /><Legend color={colors.error} label="Bearish setup" colors={colors} /><Legend color={colors.primary} label="EMA20 / MACD" colors={colors} /><Legend color={colors.warning} label="EMA50 / signal" colors={colors} /></View>
    <Text style={[styles.disclosure, { color: colors.muted }]}>Wheel or pinch to zoom, drag to pan, and use the crosshair to inspect OHLCV. Horizontal levels are local visual research aids; chart annotations document historical closed-candle signals, not trading instructions.</Text>
  </View>;
}

function Tool({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) { return <Pressable onPress={onPress} style={({ pressed }) => [styles.tool, { backgroundColor: active ? `${colors.primary}18` : `${colors.muted}12` }, pressed && styles.pressed]}><Text style={[styles.toolText, { color: active ? colors.primary : colors.muted }]}>{label}</Text></Pressable>; }
function Metric({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) { return <View style={styles.metric}><Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text></View>; }
function Legend({ color, label, colors }: { color: string; label: string; colors: ReturnType<typeof useColors> }) { return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={[styles.legendText, { color: colors.muted }]}>{label}</Text></View>; }

const styles = StyleSheet.create({ card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }, price: { fontSize: 21, fontWeight: "800" }, meta: { fontSize: 11, marginTop: 3 }, toolRow: { flexDirection: "row", gap: 6 }, tool: { minWidth: 42, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 9, alignItems: "center" }, toolText: { fontSize: 11, fontWeight: "800" }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, metric: { minWidth: 48, gap: 2 }, metricLabel: { fontSize: 9, fontWeight: "800" }, metricValue: { fontSize: 11, fontWeight: "700" }, levelRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, levelButton: { minHeight: 32, borderWidth: 1, borderRadius: 8, justifyContent: "center", paddingHorizontal: 10 }, levelText: { fontSize: 11, fontWeight: "800" }, legend: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 5 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendText: { fontSize: 10 }, disclosure: { fontSize: 11, lineHeight: 16 }, unsupported: { fontSize: 12, lineHeight: 18 }, pressed: { opacity: 0.76 }, disabled: { opacity: 0.5 } });
