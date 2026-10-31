import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chartSavesSettled,
  configureChartHistory,
  currentChartKey,
  resetChartHistoryForTests,
  useChartHistoryStore,
} from "../lib/chart-history";
import { createChartStateApi, createMockChartStateApi, type ChartStateApi } from "../lib/chart-state";
import {
  CopilotApiError,
  createCopilotApi,
  isSessionGoneBody,
  resetCopilotApiMockSessionsForTests,
  type CopilotApiClient,
} from "../lib/copilot-api";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import { COPILOT_SESSION_GONE } from "../lib/copilot-strings";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { resetGoneSessionsForTests, useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useShapeStore } from "../lib/stores/shape-store";
import { createCopilotClient } from "../lib/use-copilot";

const gone = () => new CopilotApiError(404, { code: "session_not_found", message: "Không tìm thấy phiên" }, "x");

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await chartSavesSettled();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function boot(opts: { copilot?: Partial<CopilotApiClient>; charts?: ChartStateApi } = {}) {
  localStorage.clear();
  resetCopilotApiMockSessionsForTests();
  resetChartHistoryForTests();
  resetGoneSessionsForTests();
  const base = createCopilotApi({ forceMock: true });
  const copilot = { ...base, ...opts.copilot } as CopilotApiClient;
  clearCopilotModelsCache();
  await loadCopilotModels(copilot);
  configureChartHistory({ api: opts.charts ?? createMockChartStateApi() });
  useChartStore.setState({ symbol: "BTCUSDT", interval: "1h", candles: [], connection: "live" });
  useAiStore.setState({ messages: [], inFlight: false, lastError: null });
  useShapeStore.getState().clearAll();
  useMarkerStore.getState().clearAll();
  useCopilotSessionStore.setState({ sessions: [], sessionCache: {}, activeSessionId: null, sessionsError: null });
  useCopilotSessionStore.getState().setApi(copilot);
  await useCopilotSessionStore.getState().bootstrap();
  await settle();
  return { copilot, base };
}

const state = () => useCopilotSessionStore.getState();
const listIds = () => state().sessions.map((s) => s.id);

describe("404 session_not_found: the session is gone (deleted or another device's)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("recognises session_not_found and the older {error: 'session not found'}", () => {
    expect(isSessionGoneBody(404, { code: "session_not_found" })).toBe(true);
    expect(isSessionGoneBody(404, { error: "session not found" })).toBe(true);
    expect(isSessionGoneBody(404, { code: "chart_state_not_found" })).toBe(false);
    expect(isSessionGoneBody(410, { code: "session_not_found" })).toBe(false);
  });

  it("active session gone with others listed: drop it, select the next, Vietnamese notice", async () => {
    await boot();
    const first = state().activeSessionId!;
    await state().createSession();
    await settle();
    const second = state().activeSessionId!;
    expect(listIds()).toEqual([second, first]);
    await state().handleSessionGone(second);
    await settle();
    expect(listIds()).toEqual([first]);
    expect(state().activeSessionId).toBe(first);
    expect(state().sessionsError).toBe(COPILOT_SESSION_GONE);
    // Handled once: a second report (e.g. a draining request) changes nothing.
    await state().handleSessionGone(second);
    expect(listIds()).toEqual([first]);
  });

  it("the only session gone: a new session is started", async () => {
    await boot();
    const only = state().activeSessionId!;
    await state().handleSessionGone(only);
    await settle();
    expect(state().activeSessionId).toBeTruthy();
    expect(state().activeSessionId).not.toBe(only);
    expect(listIds()).not.toContain(only);
    expect(state().sessionsError).toBe(COPILOT_SESSION_GONE);
  });

  it("PATCH (persist) 404 → handled, never retried", async () => {
    const updateSession = vi.fn(async () => {
      throw gone();
    });
    await boot({ copilot: { updateSession } });
    const sid = state().activeSessionId!;
    state().persistActiveSession();
    await state().flushPersist();
    await settle();
    expect(state().activeSessionId).not.toBe(sid);
    expect(listIds()).not.toContain(sid);
    expect(state().sessionsError).toBe(COPILOT_SESSION_GONE);
    await new Promise((r) => setTimeout(r, 600));
    expect(updateSession.mock.calls.filter((c) => (c as unknown[])[0] === sid)).toHaveLength(1);
  });

  it("GET on bootstrap 404 → the stale active id is forgotten and a new session starts", async () => {
    const { base } = await boot();
    const stale = state().activeSessionId!;
    // Reload: the saved active session now belongs to another device.
    state().setApi({ ...base, getSession: vi.fn(async () => Promise.reject(gone())) });
    await state().bootstrap();
    await settle();
    expect(state().activeSessionId).toBeTruthy();
    expect(state().activeSessionId).not.toBe(stale);
    expect(listIds()).not.toContain(stale);
    expect(state().sessionsError).toBe(COPILOT_SESSION_GONE);
  });

  it("analyze 404 session_not_found → Vietnamese error and the session is dropped", async () => {
    await boot();
    const sid = state().activeSessionId!;
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "session_not_found", message: "Không tìm thấy phiên" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
    );
    useChartStore.setState({
      candles: [0, 1, 2].map((i) => ({ time: 1_710_000_000 + i * 3600, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 })),
    });
    const client = createCopilotClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.analyze("phân tích");
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(state().activeSessionId).not.toBe(sid);
    expect(listIds()).not.toContain(sid);
  });

  it("chart GET 404 session_not_found → session dropped; plain chart_state_not_found → clean chart", async () => {
    const inner = createMockChartStateApi();
    let goneFor: string | null = null;
    const charts: ChartStateApi = {
      ...inner,
      getChart: async (sid, sym, tf) => {
        if (sid === goneFor) throw gone();
        return inner.getChart(sid, sym, tf);
      },
    };
    await boot({ charts });
    const sid = state().activeSessionId!;
    // No saved chart yet: stays on the session with a clean chart.
    expect(useChartHistoryStore.getState().loadingKey).toBeNull();
    expect(state().sessionsError).toBeNull();
    expect(currentChartKey()).toContain(sid);
    goneFor = sid;
    useChartStore.getState().setInterval("4h");
    const { switchChart } = await import("../lib/chart-history");
    switchChart("BTCUSDT", "1h");
    await settle();
    expect(state().activeSessionId).not.toBe(sid);
    expect(state().sessionsError).toBe(COPILOT_SESSION_GONE);
  });
});

describe("client fetches send the csm_device cookie (same-origin credentials)", () => {
  it("sessions API, chart-state API and analyze", async () => {
    const seen: Array<RequestCredentials | undefined> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(init?.credentials);
      return new Response(JSON.stringify({ sessions: [], charts: [] }), { status: 200 });
    });
    const f = fetchImpl as unknown as typeof fetch;
    await createCopilotApi({ fetchImpl: f, baseUrl: "" }).listSessions();
    await createChartStateApi({ fetchImpl: f, baseUrl: "" }).listCharts("s1");
    await createCopilotClient({ fetchImpl: f, baseUrl: "" }).pollHealth();
    expect(seen).toEqual(["same-origin", "same-origin", "same-origin"]);
  });
});
