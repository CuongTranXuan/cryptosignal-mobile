import { useCallback, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { ChartLegend } from "@/components/charting/chart-legend";
import { ChartLevelControls } from "@/components/charting/chart-level-controls";
import { ChartMetrics, type ChartInspection } from "@/components/charting/chart-metrics";
import { ChartToolbar } from "@/components/charting/chart-toolbar";
import { chartTimestamp, formatChartPrice } from "@/components/charting/format";
import { horizontalLevelsFromAnnotations, useLightweightChart } from "@/components/charting/use-lightweight-chart";
import { useColors } from "@/hooks/use-colors";
import { normalizeChartCandles } from "@/shared/chart-utils";
import type { ChartAnnotation, ChartDataQuality, ResearchChartPanelProps } from "@/shared/chart-types";

function createHorizontalLevelAnnotation(price: number, assetSymbol: string, timeframe: string, dataQuality: ChartDataQuality): ChartAnnotation {
  return {
    id: `level-${price}-${Date.now()}`,
    kind: "HORIZONTAL_LEVEL",
    assetSymbol,
    timeframe,
    createdAt: new Date().toISOString(),
    dataQuality,
    price,
  };
}

/** Browser-only research chart entry point for closed-candle history, indicators, and local or persisted annotations. */
export function ResearchChartPanel({
  candles,
  signals,
  assetSymbol = "BTC/USDT",
  timeframe = "1h",
  dataQuality = "CLOSED_CANDLE",
  annotations,
  onAnnotationsChange,
}: ResearchChartPanelProps) {
  const colors = useColors();
  const chartHost = useRef<HTMLDivElement | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(true);
  const [localLevels, setLocalLevels] = useState<number[]>([]);
  const [inspection, setInspection] = useState<ChartInspection | null>(null);

  const normalizedCandles = useMemo(() => normalizeChartCandles(candles), [candles]);
  const normalizedSignals = useMemo(() => {
    const candleTimes = new Set(normalizedCandles.map((candle) => chartTimestamp(candle.candleCloseTime)));
    return signals.filter((signal) => candleTimes.has(chartTimestamp(signal.candleCloseTime)) && Number.isFinite(signal.score));
  }, [normalizedCandles, signals]);

  const persistedLevels = useMemo(() => horizontalLevelsFromAnnotations(annotations), [annotations]);
  const levels = onAnnotationsChange ? persistedLevels : localLevels;

  const handleInspect = useCallback((candle: (typeof normalizedCandles)[number] | null) => {
    setInspection(candle ? { ...candle, label: new Date(candle.candleCloseTime).toLocaleString() } : null);
  }, []);

  useLightweightChart({
    host: Platform.OS === "web" ? chartHost.current : null,
    candles: normalizedCandles,
    signals: normalizedSignals,
    showEma,
    showRsi,
    showMacd,
    levels,
    onInspect: handleInspect,
  });

  if (!candles.length) return null;
  if (Platform.OS !== "web") {
    return <Text style={[styles.unsupported, { color: colors.muted }]}>Interactive charts are available in the browser dashboard.</Text>;
  }
  if (!normalizedCandles.length) {
    return <Text style={[styles.unsupported, { color: colors.muted }]}>Chart data is unavailable because the selected history contains no valid completed candles.</Text>;
  }

  const latest = inspection ?? {
    ...normalizedCandles[normalizedCandles.length - 1],
    label: new Date(normalizedCandles[normalizedCandles.length - 1].candleCloseTime).toLocaleString(),
  };

  const qualityLabel = dataQuality === "LIVE_UNCONFIRMED" ? "live unconfirmed" : "closed candle";

  const addLevel = () => {
    if (onAnnotationsChange) {
      onAnnotationsChange([...(annotations ?? []), createHorizontalLevelAnnotation(latest.close, assetSymbol, timeframe, dataQuality)]);
      return;
    }
    setLocalLevels((current) => [...current, latest.close]);
  };

  const clearLevels = () => {
    if (onAnnotationsChange) {
      onAnnotationsChange((annotations ?? []).filter((annotation) => annotation.kind !== "HORIZONTAL_LEVEL"));
      return;
    }
    setLocalLevels([]);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.price, { color: colors.foreground }]}>{formatChartPrice(latest.close)}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{latest.label} · {qualityLabel}</Text>
        </View>
        <ChartToolbar
          showEma={showEma}
          showRsi={showRsi}
          showMacd={showMacd}
          onToggleEma={() => setShowEma((current) => !current)}
          onToggleRsi={() => setShowRsi((current) => !current)}
          onToggleMacd={() => setShowMacd((current) => !current)}
        />
      </View>
      <div ref={chartHost} style={{ width: "100%", minHeight: 432 }} aria-label="Interactive historical price chart with candlesticks, indicator overlays, and signal annotations" />
      <ChartMetrics inspection={latest} />
      <ChartLevelControls hasLevels={levels.length > 0} onAddLevel={addLevel} onClearLevels={clearLevels} />
      <ChartLegend />
      <Text style={[styles.disclosure, { color: colors.muted }]}>
        Wheel or pinch to zoom, drag to pan, and use the crosshair to inspect OHLCV. Horizontal levels are local visual research aids until persisted; chart annotations document historical closed-candle signals, not trading instructions.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },
  price: { fontSize: 21, fontWeight: "800" },
  meta: { fontSize: 11, marginTop: 3 },
  disclosure: { fontSize: 11, lineHeight: 16 },
  unsupported: { fontSize: 12, lineHeight: 18 },
});
