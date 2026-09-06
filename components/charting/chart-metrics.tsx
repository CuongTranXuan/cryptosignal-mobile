import { StyleSheet, Text, View } from "react-native";

import { formatChartPrice } from "@/components/charting/format";
import { useColors } from "@/hooks/use-colors";
import type { ChartCandle } from "@/shared/chart-types";

export type ChartInspection = ChartCandle & { label: string };

type ChartMetricsProps = {
  inspection: ChartInspection;
};

export function ChartMetrics({ inspection }: ChartMetricsProps) {
  const colors = useColors();
  return (
    <View style={styles.metrics}>
      <Metric label="O" value={formatChartPrice(inspection.open)} colors={colors} />
      <Metric label="H" value={formatChartPrice(inspection.high)} colors={colors} />
      <Metric label="L" value={formatChartPrice(inspection.low)} colors={colors} />
      <Metric label="C" value={formatChartPrice(inspection.close)} colors={colors} />
      <Metric label="RSI" value={inspection.rsi14.toFixed(1)} colors={colors} />
      <Metric label="MACD" value={(inspection.macd ?? 0).toFixed(3)} colors={colors} />
    </View>
  );
}

function Metric({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { minWidth: 48, gap: 2 },
  metricLabel: { fontSize: 9, fontWeight: "800" },
  metricValue: { fontSize: 11, fontWeight: "700" },
});
