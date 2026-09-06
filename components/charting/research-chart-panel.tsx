import { useCallback, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { ChartLegend } from "@/components/charting/chart-legend";
import { ChartMetrics, type ChartInspection } from "@/components/charting/chart-metrics";
import { ChartToolbar } from "@/components/charting/chart-toolbar";
import { chartTimestamp, formatChartPrice } from "@/components/charting/format";
import { useLightweightChart } from "@/components/charting/use-lightweight-chart";
import { useColors } from "@/hooks/use-colors";
import { normalizeChartCandles } from "@/shared/chart-utils";
import type { ResearchChartPanelProps } from "@/shared/chart-types";

/** Browser-only research chart entry point for closed-candle history, indicators, and engine-authored annotations. */
export function ResearchChartPanel({
  candles,
  signals,
  assetSymbol = "BTC/USDT",
  timeframe = "1h",
  dataQuality = "CLOSED_CANDLE",
  annotations = [],
}: ResearchChartPanelProps) {
  const colors = useColors();
  const chartHost = useRef<HTMLDivElement | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(true);
  const [inspection, setInspection] = useState<ChartInspection | null>(null);

  const annotationTheme = useMemo(() => ({
    bullish: colors.success,
    bearish: colors.error,
    neutral: colors.warning,
    border: colors.border,
  }), [colors.border, colors.error, colors.success, colors.warning]);

  const normalizedCandles = useMemo(() => normalizeChartCandles(candles), [candles]);
  const normalizedSignals = useMemo(() => {
    const candleTimes = new Set(normalizedCandles.map((candle) => chartTimestamp(candle.candleCloseTime)));
    return signals.filter((signal) => candleTimes.has(chartTimestamp(signal.candleCloseTime)) && Number.isFinite(signal.score));
  }, [normalizedCandles, signals]);

  const handleInspect = useCallback((candle: (typeof normalizedCandles)[number] | null) => {
    setInspection(candle ? { ...candle, label: new Date(candle.candleCloseTime).toLocaleString() } : null);
  }, []);

  useLightweightChart({
    host: Platform.OS === "web" ? chartHost.current : null,
    candles: normalizedCandles,
    signals: normalizedSignals,
    annotations,
    annotationTheme,
    showEma,
    showRsi,
    showMacd,
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

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.price, { color: colors.foreground }]}>{formatChartPrice(latest.close)}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{latest.label} · {qualityLabel} · {assetSymbol} {timeframe}</Text>
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
      <div ref={chartHost} style={{ width: "100%", minHeight: 432 }} aria-label="Interactive historical price chart with candlesticks, indicator overlays, and methodology annotations" />
      <ChartMetrics inspection={latest} />
      <ChartLegend />
      <Text style={[styles.disclosure, { color: colors.muted }]}>
        Methodology overlays are engine-authored research evidence from closed-candle findings. They are not trading instructions.
        {annotations.length ? ` Showing ${annotations.length} annotation${annotations.length === 1 ? "" : "s"}.` : ""}
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
