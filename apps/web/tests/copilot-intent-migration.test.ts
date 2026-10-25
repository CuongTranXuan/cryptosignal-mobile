import { afterEach, describe, expect, it } from "vitest";
import {
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
} from "../lib/copilot-api";
import {
  clearLegacyChartIntentStorageForTests,
  migrateLegacyChartIntentLocalStorage,
} from "../lib/copilot-intent-migration";

const LEGACY_KEY = "copilot.chart_intent.v1";

describe("copilot-intent-migration", () => {
  afterEach(() => {
    clearLegacyChartIntentStorageForTests();
    resetCopilotApiMockSessionsForTests();
  });

  it("PATCHes legacy localStorage intents and removes entries after success", async () => {
    const api = createCopilotApi({ forceMock: true });
    const created = await api.createSession({
      title: "t",
      model_id: "provider-a/model-alpha",
      chart: {
        symbol: "BTCUSDT",
        interval: "1h",
        from: 0,
        to: 1,
        candle_count: 100,
      },
    });
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        [created.id]: { style: "smc", requested_pattern: "bos" },
      }),
    );

    await migrateLegacyChartIntentLocalStorage(api);

    const session = await api.getSession(created.id);
    expect(session.intent?.style).toBe("smc");
    expect(session.intent?.requested_pattern).toBe("bos");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
