import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

export type SignalCardData = {
  id: string;
  assetSymbol: string;
  timeframe: string;
  state: string;
  score: number;
  confidence: number;
  candleCloseTime: string | Date;
  dataQualityState: string;
};

function toneForState(state: string, colors: ReturnType<typeof useColors>) {
  if (state === "BULLISH_SETUP") return colors.success;
  if (state === "BEARISH_SETUP") return colors.error;
  return colors.warning;
}

function stateLabel(state: string) {
  return state.replaceAll("_", " ");
}

export function SignalCard({ signal, onPress }: { signal: SignalCardData; onPress?: () => void }) {
  const colors = useColors();
  const tone = toneForState(signal.state, colors);
  const closeTime = new Date(signal.candleCloseTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${signal.assetSymbol} ${signal.timeframe} ${stateLabel(signal.state)} signal`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && onPress ? styles.pressed : undefined]}
    >
      <View style={styles.topRow}>
        <View>
          <Text style={[styles.asset, { color: colors.foreground }]}>{signal.assetSymbol}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{signal.timeframe} · closed {closeTime}</Text>
        </View>
        <View style={[styles.statePill, { backgroundColor: `${tone}1A` }]}>
          <Text style={[styles.stateText, { color: tone }]}>{stateLabel(signal.state)}</Text>
        </View>
      </View>
      <View style={styles.metricsRow}>
        <Metric label="Score" value={signal.score.toFixed(2)} colors={colors} />
        <Metric label="Confidence" value={`${Math.round(signal.confidence * 100)}%`} colors={colors} />
        <Metric label="Data" value={signal.dataQualityState.replaceAll("_", " ")} colors={colors} />
      </View>
    </Pressable>
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
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 16 },
  pressed: { opacity: 0.75 },
  topRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  asset: { fontSize: 18, fontWeight: "700" },
  meta: { fontSize: 12, marginTop: 3 },
  statePill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, maxWidth: "50%" },
  stateText: { fontSize: 11, fontWeight: "800", textAlign: "right" },
  metricsRow: { flexDirection: "row", gap: 12 },
  metric: { flex: 1 },
  metricLabel: { fontSize: 11, marginBottom: 4 },
  metricValue: { fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
});
