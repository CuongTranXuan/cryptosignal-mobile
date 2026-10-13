import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MOCK_MODELS_RESPONSE,
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
} from "../lib/copilot-api";
import { buildEmptyClientSession } from "../lib/copilot-session-factory";
import {
  LEGACY_SESSIONS_STORAGE_KEY,
  loadLegacySessionsBlob,
  migrateLegacySessionsIfNeeded,
  saveLegacySessionsBlob,
} from "../lib/copilot-session-migration";

function mockFetchWithFailingCreate(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/copilot/models")) {
      return new Response(JSON.stringify(MOCK_MODELS_RESPONSE), { status: 200 });
    }
    if (url.includes("/v1/copilot/sessions") && init?.method === "POST") {
      return new Response(JSON.stringify({ error: "down" }), { status: 503 });
    }
    if (url.includes("/v1/copilot/sessions") && !init?.method) {
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

describe("copilot session migration", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
  });

  afterEach(() => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
  });

  it("migrates legacy blob and clears local storage on success", async () => {
    const api = createCopilotApi({ forceMock: true });
    const local = buildEmptyClientSession("agentrouter/deepseek-v4-flash", "Legacy", "medium");
    local.messages.push({
      id: "m1",
      role: "user",
      content: "hello",
      model_id: null,
      shapes: [],
      markers: [],
      created_at: 1,
    });
    saveLegacySessionsBlob({ active_session_id: local.id, sessions: [local] });

    const first = await migrateLegacySessionsIfNeeded(api, []);
    expect(first.failures).toHaveLength(0);
    expect(first.migratedActiveId).toBeTruthy();
    expect(loadLegacySessionsBlob().sessions).toHaveLength(0);

    const listed = await api.listSessions();
    expect(listed.sessions).toHaveLength(1);
    const full = await api.getSession(listed.sessions[0]!.id);
    expect(full.messages[0]?.content).toBe("hello");
  });

  it("rerun does not duplicate sessions", async () => {
    const api = createCopilotApi({ forceMock: true });
    const local = buildEmptyClientSession("agentrouter/deepseek-v4-flash", "Once", null);
    saveLegacySessionsBlob({ active_session_id: local.id, sessions: [local] });
    await migrateLegacySessionsIfNeeded(api, []);
    const listed = await api.listSessions();
    await migrateLegacySessionsIfNeeded(api, listed.sessions);
    expect((await api.listSessions()).sessions).toHaveLength(1);
  });

  it("keeps legacy rows when server create fails", async () => {
    const api = createCopilotApi({ fetchImpl: mockFetchWithFailingCreate() });
    const local = buildEmptyClientSession("agentrouter/deepseek-v4-flash", "Stuck", null);
    saveLegacySessionsBlob({ active_session_id: local.id, sessions: [local] });
    const result = await migrateLegacySessionsIfNeeded(api, []);
    expect(result.failures).toHaveLength(1);
    expect(loadLegacySessionsBlob().sessions).toHaveLength(1);
    expect(localStorage.getItem(LEGACY_SESSIONS_STORAGE_KEY)).toBeTruthy();
  });
});
