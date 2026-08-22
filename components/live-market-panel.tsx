import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import type { LiveMarketSnapshot, MarketComponentHealth } from "@/shared/live-market-types";

type LiveObservationPanelView = {
  conditionId: string;
  direction: string;
  score: number;
  dataQualityState: string;
};

export function LiveMarketPanel({ snapshot, health, observation }: { snapshot: LiveMarketSnapshot | null | undefined; health: MarketComponentHealth[]; observation: LiveObservationPanelView | null | undefined }) {
  const colors = useColors();
  const { t } = useI18n();
  const tradePrice = snapshot?.latestTrade?.payload.price;
  const bid = snapshot?.latestBookTicker?.payload.bidPrice;
  const ask = snapshot?.latestBookTicker?.payload.askPrice;
  const openKline = snapshot?.latestKlines["30m"] ?? snapshot?.latestKlines["1h"] ?? snapshot?.latestKlines["4h"];

  return (
    <View accessibilityLabel={t("liveMarketTitle")} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}><View><Text style={[styles.title, { color: colors.foreground }]}>{t("liveMarketTitle")}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>{t("liveMarketSubtitle")}</Text></View><View style={[styles.badge, { borderColor: colors.warning }]} accessibilityLabel="LIVE_UNCONFIRMED"><Text style={[styles.badgeCopy, { color: colors.warning }]}>{t("liveUnconfirmedBadge")}</Text><Text style={[styles.badgeState, { color: colors.warning }]}>LIVE_UNCONFIRMED</Text></View></View>
      <View style={[styles.freshness, { backgroundColor: snapshot?.stale ? `${colors.warning}14` : `${colors.success}14`, borderColor: snapshot?.stale ? colors.warning : colors.success }]}><Text style={[styles.freshnessText, { color: snapshot?.stale ? colors.warning : colors.success }]}>{snapshot?.stale ? t("liveStale") : t("liveFresh")}</Text><Text style={[styles.meta, { color: colors.muted }]}>{snapshot?.freshestEventTime ?? t("liveNoData")}</Text></View>
      <View style={styles.metrics}><Metric label={t("liveLastTrade")} value={String(tradePrice ?? "—")} colors={colors} /><Metric label={t("liveBook")} value={`${bid ?? "—"} / ${ask ?? "—"}`} colors={colors} /><Metric label={t("liveOpenKline")} value={openKline ? `${openKline.payload.open ?? "—"} → ${openKline.payload.close ?? "—"}` : "—"} colors={colors} /></View>
      <View style={[styles.observation, { backgroundColor: colors.background, borderColor: colors.border }]}><Text style={[styles.sectionLabel, { color: colors.foreground }]}>{t("liveLatestObservation")}</Text>{observation ? <><Text style={[styles.observationTitle, { color: colors.warning }]}>{t("liveUnconfirmedBadge")}</Text><Text style={[styles.observationCopy, { color: colors.muted }]}>{observation.conditionId.replace(/_V1$/, "").replaceAll("_", " ")} · {observation.direction} · {observation.score.toFixed(2)}</Text></> : <Text style={[styles.observationCopy, { color: colors.muted }]}>{t("liveNoObservation")}</Text>}</View>
      <View style={styles.healthRow}>{health.map((entry) => <View key={entry.component} style={[styles.healthPill, { borderColor: colors.border }]}><Text style={[styles.healthName, { color: colors.foreground }]}>{entry.component}</Text><Text style={[styles.healthState, { color: entry.state === "RUNNING" ? colors.success : entry.state === "DEGRADED" || entry.state === "FAILED" ? colors.error : colors.muted }]}>{entry.state}</Text></View>)}</View>
      <Text style={[styles.disclaimer, { color: colors.muted }]}>{t("liveDisclaimer")}</Text>
    </View>
  );
}

function Metric({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.metric, { backgroundColor: colors.background, borderColor: colors.border }]}><Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 }, header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }, title: { fontSize: 19, fontWeight: "800" }, subtitle: { fontSize: 12, lineHeight: 18, marginTop: 4, maxWidth: 620 }, badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, gap: 2, alignItems: "flex-end" }, badgeCopy: { fontSize: 9, fontWeight: "900", letterSpacing: 0.4 }, badgeState: { fontSize: 8, fontWeight: "900", letterSpacing: 0.35 }, freshness: { borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }, freshnessText: { fontSize: 11, fontWeight: "900" }, meta: { fontSize: 10, lineHeight: 15 }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, metric: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4, flexGrow: 1, flexBasis: 160 }, metricLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" }, metricValue: { fontSize: 13, fontWeight: "800" }, observation: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }, sectionLabel: { fontSize: 11, fontWeight: "900" }, observationTitle: { fontSize: 11, fontWeight: "900" }, observationCopy: { fontSize: 11, lineHeight: 16 }, healthRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, healthPill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, minWidth: 92 }, healthName: { fontSize: 9, fontWeight: "900" }, healthState: { fontSize: 10, fontWeight: "800", marginTop: 2 }, disclaimer: { fontSize: 11, lineHeight: 16 },
});
