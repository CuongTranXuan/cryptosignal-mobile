import { afterEach, describe, expect, it } from "vitest";
import {
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
} from "../lib/copilot-api";
import { SESSION_REASONING_TITLE_SEP } from "../lib/copilot-session-legacy-title";
import { repairLegacyEncodedSessionTitle } from "../lib/copilot-session-legacy-cleanup";

describe("legacy session title cleanup", () => {
  afterEach(() => {
    resetCopilotApiMockSessionsForTests();
  });

  it("PATCHes clean title and reasoning once, idempotent on rerun", async () => {
    const api = createCopilotApi({ forceMock: true });
    const encodedTitle = `My chat${SESSION_REASONING_TITLE_SEP}medium`;
    const created = await api.createSession({
      title: encodedTitle,
      model_id: "agentrouter/deepseek-v4-flash",
      reasoning_effort: null,
      chart: {
        symbol: "BTCUSDT",
        interval: "1h",
        from: 0,
        to: 0,
        candle_count: 100,
      },
      messages: [],
    });
    expect(created.title).toBe(encodedTitle);

    const first = await repairLegacyEncodedSessionTitle(api, created);
    expect(first.title).toBe("My chat");
    expect(first.reasoning_effort).toBe("medium");

    const second = await repairLegacyEncodedSessionTitle(api, first);
    expect(second.title).toBe("My chat");
    expect(second.reasoning_effort).toBe("medium");
  });
});
