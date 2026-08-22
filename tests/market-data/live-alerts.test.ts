import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BOT_CONFIG } from "../../server/db";
import { createLiveObservationAlertService, formatLiveObservationAlert } from "../../server/market-data/live-alerts";
import type { LiveObservation } from "../../shared/live-market-types";

const observation: LiveObservation = {
  id: "live-observation-1",
  assetSymbol: "BTC/USDT",
  observedAt: "2026-08-22T04:00:00.000Z",
  conditionId: "SPREAD_ANOMALY_V1",
  direction: "BEARISH",
  score: 0.14,
  dataQualityState: "LIVE_UNCONFIRMED",
  evidence: { spreadRatio: 0.14, bid: "100", ask: "116" },
  sourceEventIds: ["book-1"],
  configVersion: 4,
};

describe("live observation alerts", () => {
  it("formats every live alert with explicit unconfirmed, dashboard, evidence, and signals-only wording", () => {
    const text = formatLiveObservationAlert(observation);

    expect(text).toMatch(/^Unconfirmed live market observation/);
    expect(text).toContain("SPREAD ANOMALY");
    expect(text).toContain("0.14");
    expect(text).toContain("2026-08-22T04:00:00.000Z");
    expect(text).toContain("Dashboard:");
    expect(text).toContain("Signals-only: no order was placed; this is not personal financial advice.");
  });

  it("does not send a live alert when the live-only cooldown is active", async () => {
    const sendMessage = vi.fn();
    const service = createLiveObservationAlertService({
      getConfig: async () => ({ ...DEFAULT_BOT_CONFIG, isPaused: false, liveAlerts: { enabled: true, conditionIds: ["SPREAD_ANOMALY_V1"], threshold: 0.1, cooldownMinutes: 10 } }),
      hasRecentLiveAlert: async () => true,
      allowedRecipients: () => [1],
      sendMessage,
      recordAuditEvent: vi.fn(async () => undefined),
    });

    await expect(service.deliverLiveObservationAlert(observation)).resolves.toEqual({ delivered: false, reason: "COOLDOWN" });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
