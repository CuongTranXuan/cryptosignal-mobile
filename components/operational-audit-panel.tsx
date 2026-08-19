import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { RunnerHealthView } from "@/shared/signal-types";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

export function OperationalAuditPanel({ runnerHealth }: { runnerHealth: RunnerHealthView | null }) {
  const colors = useColors();
  const auditHistory = trpc.bot.auditHistory.useQuery(
    { limit: 20 },
    { refetchInterval: 30_000, refetchIntervalInBackground: true },
  );

  return (
    <View style={[styles.stack, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Runner health</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Quietly refreshed every 30 seconds from persisted runner data.</Text>
      </View>
      {runnerHealth ? (
        <View style={[styles.healthCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.healthHeading}>
            <Text style={[styles.healthState, { color: healthColor(runnerHealth.state, colors) }]}>{runnerHealth.state}</Text>
            <Text style={[styles.healthCount, { color: colors.foreground }]}>{runnerHealth.cycleCount} checks</Text>
          </View>
          <Text style={[styles.meta, { color: colors.muted }]}>{runnerHealth.finishedAt ? `Last completed ${new Date(runnerHealth.finishedAt).toLocaleString()}` : "No completed cycle reported yet"}</Text>
          {runnerHealth.lastError ? <Text style={[styles.error, { color: colors.error }]}>{runnerHealth.lastError}</Text> : null}
        </View>
      ) : <Text style={[styles.meta, { color: colors.muted }]}>Runner state is unavailable until the API responds.</Text>}

      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Operational audit history</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Read-only evidence for configuration, engine, delivery, and runner events.</Text>
      </View>
      {auditHistory.isLoading ? <ActivityIndicator color={colors.primary} /> : auditHistory.data?.length ? (
        <View style={styles.auditList}>
          {auditHistory.data.map((event) => (
            <View key={event.id} style={[styles.auditEvent, { borderColor: colors.border }]}>
              <View style={styles.auditHeading}>
                <Text style={[styles.auditAction, { color: colors.foreground }]}>{formatAction(event.action)}</Text>
                <Text style={[styles.actor, { color: colors.primary }]}>{event.actorType}</Text>
              </View>
              <Text style={[styles.meta, { color: colors.muted }]}>{new Date(event.createdAt).toLocaleString()} · {event.actorId}</Text>
              <Text style={[styles.auditCopy, { color: colors.muted }]}>{formatPayload(event.payload)}</Text>
            </View>
          ))}
        </View>
      ) : <Text style={[styles.meta, { color: colors.muted }]}>No persisted operational events yet.</Text>}
    </View>
  );
}

function healthColor(state: RunnerHealthView["state"], colors: ReturnType<typeof useColors>) {
  if (state === "SUCCESS") return colors.success;
  if (state === "DEGRADED") return colors.error;
  if (state === "RUNNING") return colors.primary;
  return colors.muted;
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
  stack: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  header: { gap: 4 },
  title: { fontSize: 19, fontWeight: "800" },
  subtitle: { fontSize: 12, lineHeight: 18 },
  healthCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 5 },
  healthHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  healthState: { fontSize: 14, fontWeight: "900", letterSpacing: 0.7 },
  healthCount: { fontSize: 12, fontWeight: "800" },
  meta: { fontSize: 10, lineHeight: 15 },
  error: { fontSize: 11, lineHeight: 16 },
  auditList: { gap: 8 },
  auditEvent: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  auditHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  auditAction: { fontSize: 12, fontWeight: "800", flex: 1 },
  actor: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  auditCopy: { fontSize: 11, lineHeight: 16 },
});
