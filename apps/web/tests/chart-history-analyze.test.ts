import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chartSavesSettled,
  configureChartHistory,
  currentChartKey,
  resetChartHistoryForTests,
  switchChart,
  useChartHistoryStore,
} from "../lib/chart-history";
import { createMockChartStateApi, type ChartStateApi } from "../lib/chart-state";
import { createCopilotApi, resetCopilotApiMockSessionsForTests } from "../lib/copilot-api";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import {
  CHART_HISTORY_KEPT_PREVIOUS_INVALID,
  CHART_HISTORY_N25_KEPT_PREVIOUS,
  COPILOT_ERROR_INVALID_REASONING,
  CHART_HISTORY_SERVER_SAVE_FAILED,
  COPILOT_SESSION_GONE,
} from "../lib/copilot-strings";
import { resetShapeLabelsForTests, shapeDisplayName } from "../lib/shape-labels";
import type { Candle, PatternShape } from "../lib/pattern-shape";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { resetGoneSessionsForTests, useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useShapeStore } from "../lib/stores/shape-store";
import { createCopilotClient } from "../lib/use-copilot";

const candles: Candle[] = [0, 1, 2, 3].map((i) => ({
  time: 1_710_000_000 + i * 3600,
  open: 1 + i,
  high: 2 + i,
  low: 0.5 + i,
  close: 1.5 + i,
  volume: 10,
}));
const closed = new Set(candles.slice(0, 3).map((c) => c.time));

const shape = (id: string, t0 = candles[0]!.time, t1 = candles[2]!.time): PatternShape => ({
  id,
  symbol: "BTCUSDT",
  interval: "1h",
  kind: "trendline",
  name: "Support trendline",
  status: "preview",
  source: "agent",
  confidence: 0.7,
  points: [
    { time: t0, price: 1 },
    { time: t1, price: 2 },
  ],
  priceLow: null,
  priceHigh: null,
  origin: "ai",
  kept: false,
  edited: false,
});

type SseExtra = { labels?: Record<string, string>; meta?: Record<string, unknown> };

function sse(shapes: PatternShape[], revision: number | null, extra: SseExtra = {}): Response {
  const meta = { model: "provider-a/model-alpha", candle_count_used: 3, clamped: false, ...extra.meta };
  const body =
    `event: shapes\ndata: ${JSON.stringify({ shapes, ...(extra.labels ? { labels: extra.labels } : {}) })}\n\n` +
    `event: analysis\ndata: ${JSON.stringify({ bias: "neutral", evidence_for: [], evidence_against: [] })}\n\n` +
    `event: text\ndata: ${JSON.stringify({ delta: `\n\nLớp phủ sẵn sàng: ${shapes.length} — Đường xu hướng hỗ trợ.` })}\n\n` +
    `event: meta\ndata: ${JSON.stringify(revision == null ? meta : { ...meta, chart_state_revision: revision })}\n\n` +
    "event: done\ndata: {}\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

let puts: Array<{ revision?: number; ids: string[] }> = [];
let inner: ChartStateApi;

async function setup(): Promise<string> {
  localStorage.clear();
  resetGoneSessionsForTests();
  resetCopilotApiMockSessionsForTests();
  resetChartHistoryForTests();
  const copilot = createCopilotApi({ forceMock: true });
  clearCopilotModelsCache();
  await loadCopilotModels(copilot);
  inner = createMockChartStateApi();
  puts = [];
  configureChartHistory({
    api: {
      ...inner,
      putChart: async (sid, sym, tf, body) => {
        puts.push({ revision: body.revision, ids: body.shapes.map((s) => s.id) });
        return inner.putChart(sid, sym, tf, body);
      },
    },
  });
  useChartStore.setState({ symbol: "BTCUSDT", interval: "1h", candles, connection: "live" });
  useAiStore.setState({ messages: [], inFlight: false, lastError: null });
  useShapeStore.getState().clearAll();
  useMarkerStore.getState().clearAll();
  useCopilotSessionStore.getState().setApi(copilot);
  await useCopilotSessionStore.getState().bootstrap();
  await chartSavesSettled();
  return useCopilotSessionStore.getState().activeSessionId!;
}

/** Fake server: saves the run into the chart doc (like analyze with session_id) and streams it. */
async function serverSave(shapes: PatternShape[]): Promise<number> {
  const sid = useCopilotSessionStore.getState().activeSessionId!;
  const current = await inner.getChart(sid, "BTCUSDT", "1h").catch(() => null);
  const doc = await inner.putChart(sid, "BTCUSDT", "1h", {
    shapes,
    ...(current ? { revision: current.revision } : {}),
  });
  return doc.revision;
}

async function analyze(
  shapes: PatternShape[],
  save = true,
  extra: SseExtra = {},
): Promise<Record<string, unknown>> {
  const fetchImpl = vi.fn(async () => sse(shapes, save ? await serverSave(shapes) : null, extra));
  const client = createCopilotClient({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getClosedTimes: () => closed,
  });
  await client.analyze("phân tích");
  await chartSavesSettled();
  await new Promise((r) => setTimeout(r, 0));
  await chartSavesSettled();
  return JSON.parse(String((fetchImpl.mock.calls[0] as unknown[] | undefined)?.[1] ? ((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body : "{}"));
}

const ids = () => useShapeStore.getState().shapes.map((s) => s.id);
const lastAgentText = () => {
  const msgs = useAiStore.getState().messages;
  return msgs.filter((m) => m.role === "agent").at(-1)?.content ?? "";
};

describe("analyze with chart history", () => {
  beforeEach(async () => {
    resetShapeLabelsForTests();
    await setup();
  });

  it("uses the shapes event `labels` for display names, falling back to the local mapping", async () => {
    const other = { ...shape("drw_other"), name: "Fib pocket 0.5–0.618" };
    expect(shapeDisplayName(shape("drw_a"))).toBe("Đường xu hướng hỗ trợ");
    await analyze([shape("drw_a"), other], true, { labels: { drw_a: "Xu hướng hỗ trợ (máy chủ)" } });
    const [a, b] = useShapeStore.getState().shapes;
    expect(shapeDisplayName(a!)).toBe("Xu hướng hỗ trợ (máy chủ)");
    expect(shapeDisplayName(b!)).not.toMatch(/Fib pocket/);
    // Canonical English name stays on the shape (it is the wire id for the agent).
    expect(a!.name).toBe("Support trendline");
  });

  it("chart_state_error session_not_found: session dropped with the Vietnamese notice, no client PUT", async () => {
    const sid = useCopilotSessionStore.getState().activeSessionId;
    await analyze([shape("drw_a")], false, { meta: { chart_state_error: "session_not_found" } });
    await new Promise((r) => setTimeout(r, 0));
    await chartSavesSettled();
    expect(puts).toHaveLength(0);
    const session = useCopilotSessionStore.getState();
    expect(session.sessionsError).toBe(COPILOT_SESSION_GONE);
    expect(session.activeSessionId).not.toBe(sid);
    expect(session.sessions.map((s) => s.id)).not.toContain(sid);
  });

  it("chart_state_error chart_state_save_failed: Vietnamese notice and the client saves", async () => {
    await analyze([shape("drw_a")], false, { meta: { chart_state_error: "chart_state_save_failed" } });
    expect(puts).toEqual([{ revision: undefined, ids: ["drw_a"] }]);
    expect(useChartHistoryStore.getState().notice).toBe(CHART_HISTORY_SERVER_SAVE_FAILED);
  });

  it("without chart_state_revision (backend did not save) the client saves what it shows", async () => {
    await analyze([shape("drw_a")], false);
    expect(puts).toEqual([{ revision: undefined, ids: ["drw_a"] }]);
  });

  it("records chart_state_revision from the final meta and does not PUT the AI result back", async () => {
    const body = await analyze([shape("drw_a"), shape("drw_b")]);
    expect(body.session_id).toBeTruthy();
    expect(ids()).toEqual(["drw_a", "drw_b"]);
    expect(puts).toHaveLength(0);
    expect(useChartHistoryStore.getState().docs[currentChartKey()!]?.revision).toBe(1);
    // existingShapes are sent without the chart-history flags (backend model forbids them).
    const existing = (await analyze([shape("drw_c")])).existingShapes as Record<string, unknown>[];
    expect(existing.map((s) => s.id)).toEqual(["drw_a", "drw_b"]);
    for (const s of existing) {
      expect(s).not.toHaveProperty("origin");
      expect(s).not.toHaveProperty("kept");
      expect(s).not.toHaveProperty("edited");
    }
  });

  it("N25: every new shape dropped by the closed-candle filter keeps the previous shapes", async () => {
    await analyze([shape("drw_a"), shape("drw_b")]);
    expect(ids()).toEqual(["drw_a", "drw_b"]);
    // Points far beyond the last closed candle + projection cap → all dropped client-side.
    const future = candles[2]!.time + 3600 * 500;
    await analyze([shape("drw_x", future, future + 3600)]);
    expect(ids()).toEqual(["drw_a", "drw_b"]);
    const text = lastAgentText();
    expect(text).toContain(CHART_HISTORY_N25_KEPT_PREVIOUS);
    // The server's "Lớp phủ sẵn sàng: 1" would contradict the note: suppressed for this run.
    expect(text).not.toMatch(/Lớp phủ sẵn sàng/);
    // The server saved the dropped shape; the client re-saves what it shows, on top of rev 2.
    expect(puts).toEqual([{ revision: 2, ids: ["drw_a", "drw_b"] }]);
  });

  it("(2) every new shape failing schema validation keeps the previous shapes (no wipe)", async () => {
    await analyze([shape("drw_a"), shape("drw_b")]);
    const broken = [
      { ...shape("drw_bad1"), kind: "spiral", points: [] },
      { ...shape("drw_bad2"), points: [{ time: "soon", price: "high" }] },
    ] as unknown as PatternShape[];
    await analyze(broken);
    expect(ids()).toEqual(["drw_a", "drw_b"]);
    const text = lastAgentText();
    expect(text).toContain(CHART_HISTORY_KEPT_PREVIOUS_INVALID);
    expect(text).not.toMatch(/Lớp phủ sẵn sàng/);
    // The client saves what it shows on top of the server's revision.
    expect(puts.at(-1)).toEqual({ revision: 2, ids: ["drw_a", "drw_b"] });
  });

  it("(2) a run that sends zero shapes still clears unpinned AI shapes (an empty result is valid)", async () => {
    await analyze([shape("drw_a")]);
    await analyze([]);
    expect(ids()).toEqual([]);
  });

  it("(5) a new AI shape reusing a pinned id loses: the pinned (kept/edited/user) shape wins", async () => {
    await analyze([shape("drw_a"), shape("drw_b")]);
    useShapeStore.getState().keep("drw_a");
    const pinnedPoints = useShapeStore.getState().shapes.find((s) => s.id === "drw_a")!.points;
    await analyze([shape("drw_a", candles[1]!.time, candles[2]!.time), shape("drw_c")]);
    const after = useShapeStore.getState().shapes;
    expect(after.map((s) => s.id)).toEqual(["drw_a", "drw_c"]);
    const a = after.find((s) => s.id === "drw_a")!;
    expect(a.kept).toBe(true);
    expect(a.points).toEqual(pinnedPoints);
  });

  it("(8) models with reasoning_efforts [] never send an explicit effort", async () => {
    useCopilotSessionStore.setState({ modelId: "combo/fast", reasoningEffort: "low" });
    const body = await analyze([shape("drw_a")]);
    expect(body.model).toBe("combo/fast");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("(8) a 400 invalid_reasoning_effort shows the Vietnamese notice and drops the stored effort", async () => {
    useCopilotSessionStore.setState({ reasoningEffort: "high" });
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "invalid_reasoning_effort", message: "reasoning_effort not supported" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = createCopilotClient({ fetchImpl: fetchImpl as unknown as typeof fetch, getClosedTimes: () => closed });
    await client.analyze("phân tích");
    expect(useAiStore.getState().lastError).toBe(COPILOT_ERROR_INVALID_REASONING);
    expect(COPILOT_ERROR_INVALID_REASONING).toMatch(/không hỗ trợ mức lý luận/);
    expect(useCopilotSessionStore.getState().reasoningEffort).toBeNull();
  });

  it("a run with drawable shapes still replaces unpinned shapes (no N25 note)", async () => {
    await analyze([shape("drw_a")]);
    await analyze([shape("drw_b")]);
    expect(ids()).toEqual(["drw_b"]);
    expect(lastAgentText()).not.toContain(CHART_HISTORY_N25_KEPT_PREVIOUS);
    expect(lastAgentText()).toMatch(/Lớp phủ sẵn sàng: 1/);
  });

  it("an edit during an analyze run is saved after the run, on top of the server's revision", async () => {
    await analyze([shape("drw_a")]);
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async () => {
      await gate;
      return sse([shape("drw_b")], await serverSave([shape("drw_b")]));
    });
    const client = createCopilotClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getClosedTimes: () => closed,
    });
    const run = client.analyze("phân tích");
    await new Promise((r) => setTimeout(r, 0));
    useShapeStore.getState().addCommitted({ ...shape("mine"), source: "human", origin: "user" });
    await new Promise((r) => setTimeout(r, 1100));
    expect(puts).toHaveLength(0); // deferred while the run is in flight
    release!();
    await run;
    await new Promise((r) => setTimeout(r, 1100));
    await chartSavesSettled();
    expect(puts).toEqual([{ revision: 2, ids: ["mine", "drw_b"] }]);
  });

  it("overlays of a run are not painted after the user switched timeframe mid-stream", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async () => {
      await gate;
      return sse([shape("drw_late")], null);
    });
    const client = createCopilotClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getClosedTimes: () => closed,
    });
    const run = client.analyze("phân tích");
    await new Promise((r) => setTimeout(r, 0));
    switchChart("BTCUSDT", "4h");
    release!();
    await run;
    await chartSavesSettled();
    expect(ids()).toEqual([]);
  });
});
