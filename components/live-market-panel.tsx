import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import type { LiveMarketSnapshot, MarketComponentHealth } from "@/shared/live-market-types";

type LiveObservationPanelView = {
  conditionId: string;
  direction: string;
  score: number;
  dataQualityState: string;
};

type PublicQuotePanelView = {
  source: "BINANCE_PUBLIC_REST";
  observedAt: string;
  bidPrice: string;
  bidQuantity: string;
  askPrice: string;
  askQuantity: string;
};

export function LiveMarketPanel({ snapshot, health, observation, quote, quoteLoading, quoteError, onRefreshQuote }: { snapshot: LiveMarketSnapshot | null | undefined; health: MarketComponentHealth[]; observation: LiveObservationPanelView | null | undefined; quote: PublicQuotePanelView | null | undefined; quoteLoading: boolean; quoteError: string | null; onRefreshQuote: () => void }) {
  const colors = useColors();
  const { t } = useI18n();
  const cacheAvailable = Boolean(snapshot?.latestTrade || snapshot?.latestBookTicker);
  const tradePrice = snapshot?.latestTrade?.payload.price ?? quote?.bidPrice;
  const bid = snapshot?.latestBookTicker?.payload.bidPrice ?? quote?.bidPrice;
  const ask = snapshot?.latestBookTicker?.payload.askPrice ?? quote?.askPrice;
  const openKline = snapshot?.latestKlines["30m"] ?? snapshot?.latestKlines["1h"] ?? snapshot?.latestKlines["4h"];
  const cacheStateKey = !cacheAvailable ? "NOT_CONNECTED" : snapshot?.stale ? "STALE" : "CONNECTED";
  const cacheState = cacheStateKey === "CONNECTED" ? t("collectorConnected") : cacheStateKey === "STALE" ? t("collectorStale") : t("collectorNotConnected");
  const cacheTone = cacheStateKey === "CONNECTED" ? colors.success : cacheStateKey === "STALE" ? colors.warning : colors.muted;

  return (
    <View accessibilityLabel={t("liveMarketTitle")} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}><View><Text style={[styles.title, { color: colors.foreground }]}>{t("liveMarketTitle")}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>{t("liveMarketSubtitle")}</Text></View><View style={[styles.badge, { borderColor: colors.warning }]} accessibilityLabel="LIVE_UNCONFIRMED"><Text style={[styles.badgeCopy, { color: colors.warning }]}>{t("liveUnconfirmedBadge")}</Text><Text style={[styles.badgeState, { color: colors.warning }]}>LIVE_UNCONFIRMED</Text></View></View>
      <View style={[styles.freshness, { backgroundColor: `${cacheTone}14`, borderColor: cacheTone }]}><View style={styles.freshnessCopy}><Text style={[styles.freshnessText, { color: cacheTone }]}>{t("collectorCache")} · {cacheState}</Text><Text style={[styles.meta, { color: colors.muted }]}>{snapshot?.freshestEventTime ?? t("collectorUnavailableDetail")}</Text></View><View style={[styles.sourceTag, { borderColor: quote ? colors.primary : colors.border }]}><Text style={[styles.sourceTagText, { color: quote ? colors.primary : colors.muted }]}>{quote ? t("publicQuoteBadge") : t("publicQuoteOnDemand")}</Text></View></View>
      <View style={styles.metrics}><Metric label={t("liveLastTrade")} value={String(tradePrice ?? "—")} colors={colors} /><Metric label={t("liveBook")} value={`${bid ?? "—"} / ${ask ?? "—"}`} colors={colors} /><Metric label={t("liveOpenKline")} value={openKline ? `${openKline.payload.open ?? "—"} → ${openKline.payload.close ?? "—"}` : "—"} colors={colors} /></View>
      <View style={[styles.quoteAction, { backgroundColor: colors.background, borderColor: colors.border }]}><View style={styles.quoteCopy}><Text style={[styles.sectionLabel, { color: colors.foreground }]}>{t("publicQuote")}</Text><Text style={[styles.observationCopy, { color: colors.muted }]}>{quote ? t("publicQuoteObserved", { time: quote.observedAt }) : quoteError ?? t("publicQuoteDetail")}</Text></View><Pressable accessibilityLabel={t("refreshQuote")} disabled={quoteLoading} onPress={onRefreshQuote} style={({ pressed }) => [styles.quoteButton, { backgroundColor: colors.primary }, pressed && styles.pressed, quoteLoading && styles.disabled]}>{quoteLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.quoteButtonText}>{t("refreshQuote")}</Text>}</Pressable></View>
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
  panel: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 }, header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }, title: { fontSize: 19, fontWeight: "800" }, subtitle: { fontSize: 12, lineHeight: 18, marginTop: 4, maxWidth: 620 }, badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, gap: 2, alignItems: "flex-end" }, badgeCopy: { fontSize: 9, fontWeight: "900", letterSpacing: 0.4 }, badgeState: { fontSize: 8, fontWeight: "900", letterSpacing: 0.35 }, freshness: { borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }, freshnessCopy: { flexGrow: 1, gap: 3, minWidth: 180 }, freshnessText: { fontSize: 11, fontWeight: "900" }, meta: { fontSize: 10, lineHeight: 15 }, sourceTag: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 4 }, sourceTagText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.45 }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, metric: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4, flexGrow: 1, flexBasis: 160 }, metricLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" }, metricValue: { fontSize: 13, fontWeight: "800" }, quoteAction: { borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" }, quoteCopy: { flexGrow: 1, minWidth: 180, gap: 4 }, quoteButton: { minHeight: 38, borderRadius: 9, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, quoteButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" }, observation: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }, sectionLabel: { fontSize: 11, fontWeight: "900" }, observationTitle: { fontSize: 11, fontWeight: "900" }, observationCopy: { fontSize: 11, lineHeight: 16 }, healthRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, healthPill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, minWidth: 92 }, healthName: { fontSize: 9, fontWeight: "900" }, healthState: { fontSize: 10, fontWeight: "800", marginTop: 2 }, disclaimer: { fontSize: 11, lineHeight: 16 }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.5 },
});
