import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_CONFIG, listLiveObservations, recordLiveObservation, updateBotConfig } from "../../server/db";

describe("live observation configuration", () => {
  it("persists live cooldown independently from confirmed cooldown", async () => {
    expect(DEFAULT_BOT_CONFIG.liveAlerts).toEqual({
      enabled: false,
      conditionIds: [],
      threshold: 0.65,
      cooldownMinutes: 15,
    });

    const next = await updateBotConfig(
      {
        liveAlerts: { enabled: true, conditionIds: ["PRICE_DISPLACEMENT_V1"], threshold: 0.72, cooldownMinutes: 15 },
      },
      "dashboard",
      DEFAULT_BOT_CONFIG,
      "DASHBOARD",
    );

    expect(next.cooldownMinutes).toBe(60);
    expect(next.liveAlerts.cooldownMinutes).toBe(15);
  });

  it("records an unconfirmed observation once and keeps its evidence out of audit-facing fields", async () => {
    const id = crypto.randomUUID();
    const observation = {
      id,
      assetSymbol: "BTC/USDT" as const,
      observedAt: new Date().toISOString(),
      conditionId: "PRICE_DISPLACEMENT_V1" as const,
      direction: "BULLISH" as const,
      score: 0.72,
      dataQualityState: "LIVE_UNCONFIRMED" as const,
      evidence: { displacement: 0.012, internalDetail: "stored-with-observation" },
      sourceEventIds: ["event-1"],
      configVersion: 1,
    };

    expect(await recordLiveObservation(observation)).toMatchObject({ isNew: true });
    expect(await recordLiveObservation(observation)).toMatchObject({ isNew: false });
    expect((await listLiveObservations(50)).find((item) => item.id === id)).toMatchObject({
      id,
      dataQualityState: "LIVE_UNCONFIRMED",
      evidence: observation.evidence,
    });
  });
});
