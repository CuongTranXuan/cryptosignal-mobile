import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
} from "../lib/copilot-api";
import {
  COPILOT_FEEDBACK_EDIT_DEBOUNCE_MS,
  createCopilotFeedbackClient,
} from "../lib/copilot-feedback";

describe("copilot-feedback", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetCopilotApiMockSessionsForTests();
  });

  it("debounces edit feedback and sends final geometry once", async () => {
    vi.useFakeTimers();
    const api = createCopilotApi({ forceMock: true });
    const calls: unknown[] = [];
    const orig = api.submitFeedback.bind(api);
    api.submitFeedback = async (body) => {
      calls.push(body);
      return orig(body);
    };

    const client = createCopilotFeedbackClient(api, {
      getSessionId: () => "sess-1",
      getMessageId: () => "msg-1",
    });

    client.scheduleEdit("d1", { id: "d1", points: [{ time: 1, price: 1 }] }, {
      id: "d1",
      points: [{ time: 1, price: 2 }],
    });
    client.scheduleEdit("d1", { id: "d1", points: [{ time: 1, price: 1 }] }, {
      id: "d1",
      points: [{ time: 1, price: 3 }],
    });

    expect(calls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(COPILOT_FEEDBACK_EDIT_DEBOUNCE_MS);
    expect(calls.length).toBe(1);
    const body = calls[0] as { action: string; after: { points: { price: number }[] } };
    expect(body.action).toBe("edit");
    expect(body.after.points[0].price).toBe(3);
    client.dispose();
  });

  it("dedupes identical keep actions and surfaces errors without throwing", async () => {
    const api = createCopilotApi({ forceMock: true });
    let attempts = 0;
    api.submitFeedback = async () => {
      attempts += 1;
      throw new Error("network");
    };
    const errors: string[] = [];
    const client = createCopilotFeedbackClient(api, {
      getSessionId: () => "sess-1",
      getMessageId: () => null,
      onError: (m) => errors.push(m),
    });

    client.keep("shape-a", { id: "shape-a" });
    client.keep("shape-a", { id: "shape-a" });
    await new Promise((r) => setTimeout(r, 20));
    expect(attempts).toBe(1);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    client.dispose();
  });
});
