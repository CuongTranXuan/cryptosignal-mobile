import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

export function ChartLegend() {
  const colors = useColors();
  return (
    <View style={styles.legend}>
      <Legend color={colors.success} label="Bullish setup" colors={colors} />
      <Legend color={colors.error} label="Bearish setup" colors={colors} />
      <Legend color={colors.primary} label="EMA20 / MACD" colors={colors} />
      <Legend color={colors.warning} label="EMA50 / signal" colors={colors} />
    </View>
  );
}

function Legend({ color, label, colors }: { color: string; label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 10 },
});
