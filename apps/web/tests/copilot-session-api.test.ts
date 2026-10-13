import { afterEach, describe, expect, it } from "vitest";
import {
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
} from "../lib/copilot-api";

describe("copilot session API (mock)", () => {
  afterEach(() => {
    resetCopilotApiMockSessionsForTests();
  });

  it("crud round-trips chart and messages", async () => {
    const api = createCopilotApi({ forceMock: true });
    const created = await api.createSession({
      title: "Test",
      model_id: "agentrouter/deepseek-v4-flash",
      chart: {
        symbol: "ETHUSDT",
        interval: "4h",
        from: 10,
        to: 20,
        candle_count: 150,
      },
      messages: [
        {
          id: "m1",
          role: "user",
          content: "hi",
          model_id: null,
          shapes: [],
          markers: [],
          created_at: 1,
        },
      ],
    });
    expect(created.chart.symbol).toBe("ETHUSDT");
    const listed = await api.listSessions();
    expect(listed.sessions.some((s) => s.id === created.id)).toBe(true);
    const got = await api.getSession(created.id);
    expect(got.messages[0]?.content).toBe("hi");
    const patched = await api.updateSession(created.id, { title: "Renamed" });
    expect(patched.title).toBe("Renamed");
    await api.deleteSession(created.id);
    await expect(api.getSession(created.id)).rejects.toThrow();
  });
});
