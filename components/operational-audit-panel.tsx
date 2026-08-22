import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import type { RunnerHealthView } from "@/shared/signal-types";

export function OperationalAuditPanel({ runnerHealth }: { runnerHealth: RunnerHealthView | null }) {
  const colors = useColors();
  const { t, locale } = useI18n();
  const auditHistory = trpc.bot.auditHistory.useQuery({ limit: 20 }, { refetchInterval: 30_000, refetchIntervalInBackground: true });
  const marketHealth = trpc.market.health.useQuery(undefined, { refetchInterval: 5_000, refetchIntervalInBackground: true });
  const formatTime = (value: Date | null) => (value ? t("lastCompleted", { time: new Date(value).toLocaleString(locale === "vi" ? "vi-VN" : "en-US") }) : t("noCompletedCycle"));

  return (
    <View style={[styles.stack, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}><Text style={[styles.title, { color: colors.foreground }]}>{t("runnerHealth")}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>{t("runnerHealthSubtitle")}</Text></View>
      {runnerHealth ? <View style={[styles.healthCard, { backgroundColor: colors.background, borderColor: colors.border }]}><View style={styles.healthHeading}><Text style={[styles.healthState, { color: healthColor(runnerHealth.state, colors) }]}>{runnerHealth.state}</Text><Text style={[styles.healthCount, { color: colors.foreground }]}>{t("checks", { count: runnerHealth.cycleCount })}</Text></View><Text style={[styles.meta, { color: colors.muted }]}>{formatTime(runnerHealth.finishedAt)}</Text>{runnerHealth.lastError ? <Text style={[styles.error, { color: colors.error }]}>{sanitizeError(runnerHealth.lastError)}</Text> : null}</View> : <Text style={[styles.meta, { color: colors.muted }]}>{t("runnerUnavailable")}</Text>}

      <View style={styles.header}><Text style={[styles.title, { color: colors.foreground }]}>{t("marketHealth")}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>{t("liveMarketSubtitle")}</Text></View>
      {marketHealth.isLoading ? <ActivityIndicator color={colors.primary} /> : <View style={styles.marketHealthList}>{marketHealth.data?.map((entry) => <View key={entry.component} style={[styles.marketHealthCard, { backgroundColor: colors.background, borderColor: colors.border }]}><View style={styles.healthHeading}><Text style={[styles.healthState, { color: healthColor(entry.state, colors) }]}>{entry.component} · {entry.state}</Text><Text style={[styles.meta, { color: colors.muted }]}>{entry.lagMs === null ? "—" : `${entry.lagMs}ms`}</Text></View><Text style={[styles.meta, { color: colors.muted }]}>{formatTime(entry.lastSuccessAt)}</Text>{entry.lastError ? <Text style={[styles.error, { color: colors.error }]}>{sanitizeError(entry.lastError)}</Text> : null}</View>)}</View>}

      <View style={styles.header}><Text style={[styles.title, { color: colors.foreground }]}>{t("auditHistory")}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>{t("auditHistorySubtitle")}</Text></View>
      {auditHistory.isLoading ? <ActivityIndicator color={colors.primary} /> : auditHistory.data?.length ? <View style={styles.auditList}>{auditHistory.data.map((event) => <View key={event.id} style={[styles.auditEvent, { borderColor: colors.border }]}><View style={styles.auditHeading}><Text style={[styles.auditAction, { color: colors.foreground }]}>{formatAction(event.action)}</Text><Text style={[styles.actor, { color: colors.primary }]}>{event.actorType}</Text></View><Text style={[styles.meta, { color: colors.muted }]}>{new Date(event.createdAt).toLocaleString(locale === "vi" ? "vi-VN" : "en-US")} · {event.actorId}</Text><Text style={[styles.auditCopy, { color: colors.muted }]}>{formatPayload(event.payload)}</Text></View>)}</View> : <Text style={[styles.meta, { color: colors.muted }]}>{t("noOperationalEvents")}</Text>}
    </View>
  );
}

function healthColor(state: string, colors: ReturnType<typeof useColors>) {
  if (state === "SUCCESS" || state === "RUNNING") return state === "SUCCESS" ? colors.success : colors.primary;
  if (state === "DEGRADED" || state === "FAILED") return colors.error;
  return colors.muted;
}

function sanitizeError(value: string) {
  return value
    .replace(/(?:https?|redis|mysql|postgres):\/\/[^\s]+/gi, "[endpoint redacted]")
    .replace(/(password|secret|token|accesskey|signature|authorization)(\s*[=:]\s*)[^\s,;]+/gi, (_match, key: string, separator: string) => `${key}${separator}[redacted]`);
}

function formatAction(action: string) {
  return action.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (value) => value.toUpperCase());
}

function formatPayload(payload: Record<string, unknown>) {
  if (typeof payload.state === "string") return `State: ${payload.state}${typeof payload.failureCount === "number" ? ` · failures ${payload.failureCount}` : ""}`;
  if (typeof payload.configVersion === "number") return `Configuration version ${payload.configVersion}`;
  if (typeof payload.alertKey === "string") return `Alert key: ${payload.alertKey}`;
  return "Recorded operational event.";
}

const styles = StyleSheet.create({
  stack: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 }, header: { gap: 4 }, title: { fontSize: 19, fontWeight: "800" }, subtitle: { fontSize: 12, lineHeight: 18 }, healthCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 5 }, healthHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }, healthState: { fontSize: 14, fontWeight: "900", letterSpacing: 0.7 }, healthCount: { fontSize: 12, fontWeight: "800" }, meta: { fontSize: 10, lineHeight: 15 }, error: { fontSize: 11, lineHeight: 16 }, marketHealthList: { gap: 8 }, marketHealthCard: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }, auditList: { gap: 8 }, auditEvent: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }, auditHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }, auditAction: { fontSize: 12, fontWeight: "800", flex: 1 }, actor: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" }, auditCopy: { fontSize: 11, lineHeight: 16 },
});
