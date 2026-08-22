import { getBotConfig, hasRecentLiveAlert, recordAuditEvent } from "../db";
import { getAllowedTelegramRecipientIds, sendTelegramMessage } from "../telegram-polling";
import type { LiveObservation } from "../../shared/live-market-types";

const WEB_DASHBOARD_URL = process.env.DASHBOARD_PUBLIC_URL ?? "https://cryptosig-3gv3ybwa.manus.space";

export function formatLiveObservationAlert(observation: LiveObservation) {
  const evidence = Object.entries(observation.evidence)
    .map(([key, value]) => `${key}: ${typeof value === "number" ? value.toFixed(4) : String(value)}`)
    .join(" · ");
  return [
    "Unconfirmed live market observation",
    `${observation.assetSymbol} · ${observation.conditionId.replace(/_V1$/, "").replaceAll("_", " ")}`,
    `${observation.direction} | score ${observation.score.toFixed(2)} | LIVE_UNCONFIRMED`,
    `Evidence: ${evidence}`,
    `Event time: ${observation.observedAt}`,
    `Dashboard: ${WEB_DASHBOARD_URL}`,
    "Signals-only: no order was placed; this is not personal financial advice.",
  ].join("\n");
}

export function createLiveObservationAlertService(deps: {
  getConfig: typeof getBotConfig;
  hasRecentLiveAlert: typeof hasRecentLiveAlert;
  allowedRecipients: () => number[];
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
  recordAuditEvent: typeof recordAuditEvent;
}) {
  return {
    async deliverLiveObservationAlert(observation: LiveObservation) {
      const config = await deps.getConfig();
      const liveAlerts = config.liveAlerts;
      if (config.isPaused) return { delivered: false, reason: "PAUSED" as const };
      if (!liveAlerts.enabled || !liveAlerts.conditionIds.includes(observation.conditionId)) return { delivered: false, reason: "DISABLED" as const };
      if (observation.score < liveAlerts.threshold) return { delivered: false, reason: "BELOW_THRESHOLD" as const };
      const alertKey = `${observation.assetSymbol}:${observation.conditionId}:${observation.direction}`;
      if (await deps.hasRecentLiveAlert(alertKey, liveAlerts.cooldownMinutes)) return { delivered: false, reason: "COOLDOWN" as const };
      const recipients = deps.allowedRecipients();
      if (recipients.length === 0) return { delivered: false, reason: "NO_ALLOWED_RECIPIENT" as const };
      const text = formatLiveObservationAlert(observation);
      const results = await Promise.allSettled(recipients.map((chatId) => deps.sendMessage(chatId, text)));
      const deliveredRecipients = recipients.filter((_chatId, index) => results[index]?.status === "fulfilled");
      const failures = results
        .map((result, index) => ({ result, chatId: recipients[index] }))
        .filter((entry) => entry.result.status === "rejected")
        .map((entry) => ({ chatId: entry.chatId, error: String((entry.result as PromiseRejectedResult).reason) }));
      if (deliveredRecipients.length > 0) {
        await deps.recordAuditEvent("LIVE_OBSERVATION_ALERT_SENT", "TELEGRAM", "live-evaluator", { alertKey, observationId: observation.id, recipients: deliveredRecipients, failures });
        return { delivered: true, reason: "SENT" as const };
      }
      await deps.recordAuditEvent("LIVE_OBSERVATION_ALERT_FAILED", "TELEGRAM", "live-evaluator", { alertKey, observationId: observation.id, failures });
      return { delivered: false, reason: "DELIVERY_FAILED" as const };
    },
  };
}

const defaultService = createLiveObservationAlertService({
  getConfig: getBotConfig,
  hasRecentLiveAlert,
  allowedRecipients: getAllowedTelegramRecipientIds,
  sendMessage: sendTelegramMessage,
  recordAuditEvent,
});

export const deliverLiveObservationAlert = defaultService.deliverLiveObservationAlert;
