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
import { CHART_HISTORY_N25_KEPT_PREVIOUS } from "../lib/copilot-strings";
import type { Candle, PatternShape } from "../lib/pattern-shape";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
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

function sse(shapes: PatternShape[], revision: number | null): Response {
  const meta = { model: "provider-a/model-alpha", candle_count_used: 3, clamped: false };
  const body =
    `event: shapes\ndata: ${JSON.stringify({ shapes })}\n\n` +
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

async function analyze(shapes: PatternShape[], save = true): Promise<Record<string, unknown>> {
  const fetchImpl = vi.fn(async () => sse(shapes, save ? await serverSave(shapes) : null));
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
    await setup();
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
