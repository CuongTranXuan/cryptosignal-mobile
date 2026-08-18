import * as Linking from "expo-linking";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { SignalCard } from "@/components/signal-card";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

export default function OverviewScreen() {
  const colors = useColors();
  const status = trpc.bot.status.useQuery();
  const latest = trpc.signal.latest.useQuery();
  const telegramUrl = status.data?.telegramBotUrl;

  const openTelegram = async () => {
    if (!telegramUrl) return;
    await Linking.openURL(telegramUrl);
  };

  return (
    <ScreenContainer className="px-4" edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.headingBlock}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>CRYPTO SIGNAL</Text>
          <Text style={[styles.heading, { color: colors.foreground }]}>Market research, not execution.</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Closed-candle analysis is controlled through Telegram. This companion only mirrors service status and evidence.</Text>
        </View>

        {status.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {status.data ? (
          <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: status.data.isPaused ? colors.warning : colors.success }]} />
              <View style={styles.statusCopy}>
                <Text style={[styles.statusTitle, { color: colors.foreground }]}>{status.data.isPaused ? "Alerts paused" : "Monitoring closed candles"}</Text>
                <Text style={[styles.statusMeta, { color: colors.muted }]}>{status.data.executionEnabled ? "Execution enabled" : "Signals-only · execution disabled"}</Text>
              </View>
              <Text style={[styles.polling, { color: colors.primary }]}>{status.data.telegramMode.replaceAll("_", " ")}</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.watchlistRow}>
              <Text style={[styles.smallLabel, { color: colors.muted }]}>Watchlist</Text>
              <Text style={[styles.watchlist, { color: colors.foreground }]}>{status.data.watchlist.join(" · ")}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Latest signal</Text>
          <Text style={[styles.sectionMeta, { color: colors.muted }]}>Persisted before delivery</Text>
        </View>
        {latest.data ? <SignalCard signal={latest.data} /> : <EmptyState title="No signal snapshot yet" detail="Run the local signals-only analysis cycle to evaluate a fresh closed candle." colors={colors} />}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Telegram controls"
          disabled={!telegramUrl}
          onPress={openTelegram}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, !telegramUrl ? styles.disabled : undefined, pressed && telegramUrl ? styles.pressed : undefined]}
        >
          <Text style={styles.primaryButtonText}>{telegramUrl ? "Open Telegram controls" : "Telegram bot link not configured"}</Text>
        </Pressable>
        <Text style={[styles.disclosure, { color: colors.muted }]}>Signal states summarize rule evidence. They are not investment advice or instructions to trade.</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function EmptyState({ title, detail, colors }: { title: string; detail: string; colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.emptyDetail, { color: colors.muted }]}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  scrollContent: { paddingTop: 16, paddingBottom: 32, gap: 20 },
  headingBlock: { gap: 7 },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  heading: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, lineHeight: 36 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  statusCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusCopy: { flex: 1 },
  statusTitle: { fontSize: 16, fontWeight: "700" },
  statusMeta: { fontSize: 12, marginTop: 3 },
  polling: { fontSize: 11, fontWeight: "800", textTransform: "capitalize", maxWidth: 86, textAlign: "right" },
  divider: { height: StyleSheet.hairlineWidth },
  watchlistRow: { gap: 4 },
  smallLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  watchlist: { fontSize: 14, fontWeight: "600" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  sectionTitle: { fontSize: 18, fontWeight: "800" },
  sectionMeta: { fontSize: 11 },
  emptyState: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "700" },
  emptyDetail: { fontSize: 13, lineHeight: 19 },
  primaryButton: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  disclosure: { fontSize: 12, lineHeight: 18, textAlign: "center", paddingHorizontal: 16 },
});
