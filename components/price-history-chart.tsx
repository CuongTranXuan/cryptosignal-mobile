import { useMemo, useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";

import { useColors } from "@/hooks/use-colors";

type Candle = {
  candleCloseTime: string | Date;
  open: number; high: number; low: number; close: number;
  ema20: number; ema50: number; rsi14: number;
};
type SignalMarker = { candleCloseTime: string | Date; state: string; score: number };

export function PriceHistoryChart({ candles, signals }: { candles: Candle[]; signals: SignalMarker[] }) {
  const colors = useColors();
  const [width, setWidth] = useState(340);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showRsi, setShowRsi] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const height = showRsi ? 268 : 220;
  const selected = selectedIndex === null ? candles[candles.length - 1] : candles[selectedIndex];

  const geometry = useMemo(() => {
    const pad = { left: 8, right: 8, top: 12, bottom: showRsi ? 72 : 22 };
    const priceHeight = height - pad.top - pad.bottom;
    const values = candles.flatMap((candle) => [candle.high, candle.low, candle.ema20, candle.ema50]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, max * 0.002);
    const x = (index: number) => pad.left + (index / Math.max(candles.length - 1, 1)) * (width - pad.left - pad.right);
    const y = (value: number) => pad.top + ((max - value) / range) * priceHeight;
    const rsiY = (value: number) => height - 12 - ((value / 100) * 44);
    const path = (key: "ema20" | "ema50") => candles.map((candle, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(candle[key]).toFixed(1)}`).join(" ");
    const rsiPath = candles.map((candle, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${rsiY(candle.rsi14).toFixed(1)}`).join(" ");
    return { pad, priceHeight, min, max, x, y, rsiY, path, rsiPath };
  }, [candles, height, showRsi, width]);

  if (candles.length === 0) return null;
  const handleTouch = (event: LayoutChangeEvent | any) => {
    const x = event.nativeEvent.locationX ?? 0;
    const usable = width - geometry.pad.left - geometry.pad.right;
    const ratio = Math.max(0, Math.min(1, (x - geometry.pad.left) / usable));
    setSelectedIndex(Math.round(ratio * (candles.length - 1)));
  };
  const candleWidth = Math.max(2, Math.min(10, (width - 16) / candles.length * 0.62));

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.toolbar}>
        <View><Text style={[styles.price, { color: colors.foreground }]}>{selected.close.toLocaleString(undefined, { maximumFractionDigits: 4 })}</Text><Text style={[styles.meta, { color: colors.muted }]}>{new Date(selected.candleCloseTime).toLocaleString()}</Text></View>
        <View style={styles.toggles}>
          <Pressable onPress={() => setShowEma((value) => !value)} style={[styles.toggle, { backgroundColor: showEma ? `${colors.primary}18` : `${colors.muted}12` }]}><Text style={[styles.toggleText, { color: showEma ? colors.primary : colors.muted }]}>EMA</Text></Pressable>
          <Pressable onPress={() => setShowRsi((value) => !value)} style={[styles.toggle, { backgroundColor: showRsi ? `${colors.success}18` : `${colors.muted}12` }]}><Text style={[styles.toggleText, { color: showRsi ? colors.success : colors.muted }]}>RSI</Text></Pressable>
        </View>
      </View>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} onTouchStart={handleTouch} onTouchMove={handleTouch} style={styles.chartTouchTarget}>
        <Svg width={width} height={height} accessibilityLabel="Interactive historical price chart with indicator lines and signal markers">
          {[0.25, 0.5, 0.75].map((ratio) => <Line key={ratio} x1={geometry.pad.left} x2={width - geometry.pad.right} y1={geometry.pad.top + geometry.priceHeight * ratio} y2={geometry.pad.top + geometry.priceHeight * ratio} stroke={colors.border} strokeDasharray="3 4" />)}
          {candles.map((candle, index) => {
            const up = candle.close >= candle.open;
            const color = up ? colors.success : colors.error;
            const bodyTop = geometry.y(Math.max(candle.open, candle.close));
            const bodyBottom = geometry.y(Math.min(candle.open, candle.close));
            return <G key={String(candle.candleCloseTime)}>
              <Line x1={geometry.x(index)} x2={geometry.x(index)} y1={geometry.y(candle.high)} y2={geometry.y(candle.low)} stroke={color} strokeWidth={1.2} />
              <Rect x={geometry.x(index) - candleWidth / 2} y={bodyTop} width={candleWidth} height={Math.max(1.5, bodyBottom - bodyTop)} fill={color} rx={1} />
            </G>;
          })}
          {showEma ? <><Path d={geometry.path("ema20")} stroke={colors.primary} strokeWidth={1.8} fill="none" /><Path d={geometry.path("ema50")} stroke={colors.warning} strokeWidth={1.5} fill="none" /></> : null}
          {signals.map((signal, index) => {
            const target = candles.findIndex((candle) => new Date(candle.candleCloseTime).getTime() === new Date(signal.candleCloseTime).getTime());
            if (target < 0) return null;
            const markerColor = signal.state === "BULLISH_SETUP" ? colors.success : signal.state === "BEARISH_SETUP" ? colors.error : colors.warning;
            return <Circle key={`${signal.candleCloseTime}-${index}`} cx={geometry.x(target)} cy={geometry.y(candles[target].close) - 8} r={4.5} fill={markerColor} stroke={colors.surface} strokeWidth={2} />;
          })}
          {selectedIndex !== null ? <Line x1={geometry.x(selectedIndex)} x2={geometry.x(selectedIndex)} y1={geometry.pad.top} y2={height - 12} stroke={colors.foreground} strokeOpacity={0.25} strokeDasharray="2 3" /> : null}
          {showRsi ? <><Line x1={geometry.pad.left} x2={width - geometry.pad.right} y1={geometry.rsiY(70)} y2={geometry.rsiY(70)} stroke={colors.warning} strokeOpacity={0.45} strokeDasharray="3 3" /><Line x1={geometry.pad.left} x2={width - geometry.pad.right} y1={geometry.rsiY(30)} y2={geometry.rsiY(30)} stroke={colors.success} strokeOpacity={0.45} strokeDasharray="3 3" /><Path d={geometry.rsiPath} stroke={colors.success} strokeWidth={1.5} fill="none" /></> : null}
        </Svg>
      </View>
      <View style={styles.legend}><Legend color={colors.success} label="Bullish setup" colors={colors} /><Legend color={colors.error} label="Bearish setup" colors={colors} /><Legend color={colors.warning} label="Neutral / EMA50" colors={colors} /></View>
      <Text style={[styles.disclosure, { color: colors.muted }]}>Tap or drag across the chart to inspect a closed candle. Lines and markers are historical evidence, not a trading instruction.</Text>
    </View>
  );
}

function Legend({ color, label, colors }: { color: string; label: string; colors: ReturnType<typeof useColors> }) { return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={[styles.legendText, { color: colors.muted }]}>{label}</Text></View>; }
const styles = StyleSheet.create({ card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 }, toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, price: { fontSize: 21, fontWeight: "800" }, meta: { fontSize: 11, marginTop: 3 }, toggles: { flexDirection: "row", gap: 6 }, toggle: { minWidth: 42, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 9, alignItems: "center" }, toggleText: { fontSize: 11, fontWeight: "800" }, chartTouchTarget: { minHeight: 220 }, legend: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 5 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendText: { fontSize: 10 }, disclosure: { fontSize: 11, lineHeight: 16 } });
