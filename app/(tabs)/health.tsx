import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

export default function HealthScreen() {
  const colors = useColors();
  const status = trpc.bot.status.useQuery();
  return (
    <ScreenContainer className="px-4" edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>OPERATIONS</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>System health</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>This screen exposes operational state without concealing missing or stale information.</Text>
        {status.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {status.data ? <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <HealthRow label="Runtime mode" value={status.data.mode.replaceAll("_", " ")} valueColor={colors.primary} colors={colors} />
          <HealthRow label="Alert state" value={status.data.isPaused ? "Paused" : "Monitoring"} valueColor={status.data.isPaused ? colors.warning : colors.success} colors={colors} />
          <HealthRow label="Telegram transport" value={status.data.telegramMode.replaceAll("_", " ")} valueColor={colors.foreground} colors={colors} />
          <HealthRow label="Order execution" value={status.data.executionEnabled ? "Enabled" : "Disabled by design"} valueColor={status.data.executionEnabled ? colors.error : colors.success} colors={colors} />
          <HealthRow label="Latest closed candle" value={status.data.latestSignalAt ? new Date(status.data.latestSignalAt).toLocaleString() : "Unknown — no persisted snapshot"} valueColor={colors.foreground} colors={colors} />
        </View> : <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.failure, { color: colors.error }]}>Unable to load backend health.</Text><Text style={[styles.failureCopy, { color: colors.muted }]}>Check that the API and persistent signal runtime are available.</Text></View>}
        <View style={[styles.notice, { backgroundColor: `${colors.warning}14` }]}><Text style={[styles.noticeTitle, { color: colors.warning }]}>Durable hosting required</Text><Text style={[styles.noticeCopy, { color: colors.foreground }]}>Long polling and recurring analysis require a persistent host. The development environment validates the system but is not a durable runtime.</Text></View>
      </ScrollView>
    </ScreenContainer>
  );
}

function HealthRow({ label, value, valueColor, colors }: { label: string; value: string; valueColor: string; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.row}><Text style={[styles.label, { color: colors.muted }]}>{label}</Text><Text style={[styles.value, { color: valueColor }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 32, gap: 14 },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.1 },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  subtitle: { fontSize: 14, lineHeight: 21, marginBottom: 6 },
  card: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { padding: 15, gap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#DCE3F0" },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  value: { fontSize: 15, lineHeight: 21, fontWeight: "700", textTransform: "capitalize" },
  failure: { fontSize: 16, fontWeight: "800", paddingHorizontal: 15, paddingTop: 15 },
  failureCopy: { fontSize: 13, lineHeight: 19, padding: 15 },
  notice: { borderRadius: 16, padding: 16, gap: 5 },
  noticeTitle: { fontSize: 14, fontWeight: "800" },
  noticeCopy: { fontSize: 13, lineHeight: 19 },
});
