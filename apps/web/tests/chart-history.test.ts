import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CHART_SAVE_DEBOUNCE_MS,
  chartSavesSettled,
  configureChartHistory,
  currentChartKey,
  mergeChartConflict,
  resetChartHistoryForTests,
  switchChart,
  useChartHistoryStore,
} from "../lib/chart-history";
import {
  ChartConflictBodySchema,
  ChartIndexResponseSchema,
  chartConflictCurrent,
  chartTooLargeLimit,
  createMockChartStateApi,
  isChartStateNotFound,
  parseChartStateDoc,
  type ChartStateApi,
} from "../lib/chart-state";
import { CopilotApiError, createCopilotApi, resetCopilotApiMockSessionsForTests } from "../lib/copilot-api";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import { CopilotSessionApiSchema } from "../lib/copilot-schema";
import { CHART_HISTORY_CONFLICT } from "../lib/copilot-strings";
import { INTERVALS, PatternShapeSchema, type PatternShape } from "../lib/pattern-shape";
import { intervalBarSeconds, maxProjectionBarsForInterval } from "../lib/shape-projection";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useShapeStore } from "../lib/stores/shape-store";

/** Backend wire fixtures (apps/copilot/tests/fixtures/wire, docs/CHART_HISTORY_SPEC.md). */
const wire = (name: string) =>
  JSON.parse(
    readFileSync(path.resolve(__dirname, "../../copilot/tests/fixtures/wire", name), "utf8"),
  );
const docFixture = wire("chart_state.json");
const indexFixture = wire("chart_index.json");
const conflictFixture = wire("chart_conflict_409.json");

const shape = (id: string, interval: PatternShape["interval"] = "1h", extra: Partial<PatternShape> = {}): PatternShape => ({
  id,
  symbol: "BTCUSDT",
  interval,
  kind: "trendline",
  name: "Support trendline",
  status: "committed",
  source: "agent",
  confidence: 0.7,
  points: [
    { time: 1_710_000_000, price: 1 },
    { time: 1_710_007_200, price: 2 },
  ],
  priceLow: null,
  priceHigh: null,
  origin: "ai",
  kept: false,
  edited: false,
  ...extra,
});

const ids = () => useShapeStore.getState().shapes.map((s) => s.id);

/** Mock contract API with call spies. */
function spyApi(inner: ChartStateApi = createMockChartStateApi()) {
  const calls = { get: 0, put: [] as Array<{ key: string; body: Record<string, unknown> }> };
  const api: ChartStateApi = {
    listCharts: (sid) => inner.listCharts(sid),
    getChart: async (sid, sym, tf) => {
      calls.get += 1;
      return inner.getChart(sid, sym, tf);
    },
    putChart: async (sid, sym, tf, body) => {
      calls.put.push({ key: `${sym}|${tf}`, body: body as unknown as Record<string, unknown> });
      return inner.putChart(sid, sym, tf, body);
    },
    deleteChart: (sid, sym, tf) => inner.deleteChart(sid, sym, tf),
  };
  return { api, calls, inner };
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await chartSavesSettled();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function bootSession(api: ChartStateApi): Promise<string> {
  localStorage.clear();
  resetCopilotApiMockSessionsForTests();
  resetChartHistoryForTests();
  const copilot = createCopilotApi({ forceMock: true });
  clearCopilotModelsCache();
  await loadCopilotModels(copilot);
  configureChartHistory({ api });
  useChartStore.setState({ symbol: "BTCUSDT", interval: "1h", candles: [], connection: "live" });
  useAiStore.setState({ messages: [], inFlight: false, lastError: null });
  useShapeStore.getState().clearAll();
  useMarkerStore.getState().clearAll();
  useCopilotSessionStore.getState().setApi(copilot);
  await useCopilotSessionStore.getState().bootstrap();
  await flushAsync();
  return useCopilotSessionStore.getState().activeSessionId!;
}

describe("chart-state wire fixtures (backend apps/copilot/tests/fixtures/wire)", () => {
  it("parses the saved doc without dropping shapes or markers; flags kept", () => {
    const doc = parseChartStateDoc(docFixture);
    expect(doc.revision).toBe(2);
    expect(doc.chart_state_revision).toBe(2);
    expect(doc.shapes).toHaveLength(docFixture.shapes.length);
    expect(doc.markers).toHaveLength(docFixture.markers.length);
    expect(doc.shapes.map((s) => [s.id, s.origin, s.kept, s.edited])).toEqual([
      ["user-1", "user", false, false],
      ["ai-kept", "ai", true, false],
      ["ai-edited", "ai", false, true],
      ["ai-new-1", "ai", false, false],
    ]);
    // Saved shapes are on the chart: never ghost previews.
    expect(doc.shapes.every((s) => s.status === "committed")).toBe(true);
    expect(doc.analysis?.bias).toBe("bullish");
    expect(doc.view).toEqual({ from: 1789280000, to: 1790864000 });
    for (const s of doc.shapes) expect(PatternShapeSchema.safeParse(s).success).toBe(true);
  });

  it("parses the index and the 409 body", () => {
    const index = ChartIndexResponseSchema.parse(indexFixture);
    expect(index.charts.map((c) => `${c.symbol}|${c.interval}`)).toEqual(["BTCUSDT|30m", "BTCUSDT|4h"]);
    expect(ChartConflictBodySchema.parse(conflictFixture).current.revision).toBe(2);
    const err = new CopilotApiError(409, conflictFixture as never, "revision_conflict");
    expect(chartConflictCurrent(err)?.shapes.map((s) => s.id)).toEqual([
      "user-1",
      "ai-kept",
      "ai-edited",
      "ai-new-1",
    ]);
  });

  it("parses null optionals the way pydantic dumps them", () => {
    const doc = parseChartStateDoc({
      ...docFixture,
      shapes: docFixture.shapes.map((s: Record<string, unknown>) => ({ ...s, guardrail: null, agentId: null })),
      markers: docFixture.markers.map((m: Record<string, unknown>) => ({ ...m, label: null, guardrail: null })),
    });
    expect(doc.shapes).toHaveLength(4);
    expect(doc.markers).toHaveLength(2);
  });

  it("recognises 404 chart_state_not_found and 413 limits", () => {
    expect(isChartStateNotFound(new CopilotApiError(404, { code: "chart_state_not_found" }, "x"))).toBe(true);
    expect(isChartStateNotFound(new CopilotApiError(404, { error: "session not found" }, "x"))).toBe(false);
    const tooLarge = new CopilotApiError(
      413,
      { code: "chart_state_too_large", limit: { shapes: 200 } } as never,
      "x",
    );
    expect(chartTooLargeLimit(tooLarge)).toBe("shapes 200");
  });
});

describe("30m timeframe", () => {
  it("is in the interval enum with 1800 s bars and a future-k cap of 27", () => {
    expect(INTERVALS).toContain("30m");
    expect(intervalBarSeconds("30m")).toBe(1800);
    expect(maxProjectionBarsForInterval("30m")).toBe(27);
  });
});

describe("shape flags (pins survive reloads)", () => {
  beforeEach(() => {
    resetChartHistoryForTests();
    useShapeStore.getState().clearAll();
  });

  it("Giữ sets kept, drag/resize sets edited; a new run keeps them and replaces the rest", () => {
    const store = useShapeStore.getState();
    store.setChartShapes([shape("a"), shape("b"), shape("c"), shape("u", "1h", { source: "human", origin: "user" })]);
    store.keep("a");
    store.patchPoints("b", [
      { time: 1_710_000_000, price: 3 },
      { time: 1_710_007_200, price: 4 },
    ]);
    expect(useShapeStore.getState().shapes.find((s) => s.id === "a")?.kept).toBe(true);
    expect(useShapeStore.getState().shapes.find((s) => s.id === "b")?.edited).toBe(true);
    useShapeStore.getState().replaceAgentShapes([shape("n")]);
    expect(ids()).toEqual(["a", "b", "u", "n"]);
  });

  it("flags restored from a saved doc pin shapes without any in-memory state", () => {
    const doc = parseChartStateDoc(docFixture);
    useShapeStore.getState().setChartShapes(doc.shapes);
    useShapeStore.getState().replaceAgentShapes([shape("drw_new")]);
    expect(ids()).toEqual(["user-1", "ai-kept", "ai-edited", "drw_new"]);
  });
});

describe("409 merge", () => {
  it("keeps the server's AI shapes, local pins and user shapes; drops shapes deleted locally", () => {
    const server = parseChartStateDoc(conflictFixture.current);
    const local = [
      shape("ai-old"), // unpinned stale AI → replaced by the server run
      shape("ai-new-1", "4h", { kept: true }), // kept locally: local version wins
      shape("mine", "4h", { source: "human", origin: "user" }),
    ];
    // ai-edited was in the last saved doc and is gone locally → user deleted it.
    const merged = mergeChartConflict(server, local, server.markers, ["ai-edited", "ai-old"]);
    expect(merged.shapes.map((s) => s.id)).toEqual(["user-1", "ai-kept", "ai-new-1", "mine"]);
    expect(merged.shapes.find((s) => s.id === "ai-new-1")?.kept).toBe(true);
    expect(merged.markers.map((m) => m.drawing_id)).toEqual(["ai-kept", "ai-new-1"]);
  });
});

describe("chart history controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("404 → clean chart; edits PUT once after the 1 s debounce with the base revision", async () => {
    const { api, calls } = spyApi();
    await bootSession(api);
    expect(ids()).toEqual([]);
    expect(useChartHistoryStore.getState().loadingKey).toBeNull();

    vi.useFakeTimers();
    useShapeStore.getState().addCommitted(shape("u1", "1h", { source: "human", origin: "user" }));
    useShapeStore.getState().patchPoints("u1", shape("u1").points);
    vi.advanceTimersByTime(CHART_SAVE_DEBOUNCE_MS - 10);
    expect(calls.put).toHaveLength(0);
    vi.advanceTimersByTime(20);
    vi.useRealTimers();
    await flushAsync();
    expect(calls.put).toHaveLength(1);
    expect(calls.put[0]?.body.revision).toBeUndefined(); // create
    const key = currentChartKey()!;
    expect(useChartHistoryStore.getState().docs[key]?.revision).toBe(1);

    useShapeStore.getState().remove("u1");
    await new Promise((r) => setTimeout(r, CHART_SAVE_DEBOUNCE_MS + 20));
    await flushAsync();
    expect(calls.put).toHaveLength(2);
    expect(calls.put[1]?.body.revision).toBe(1);
  });

  it("switch timeframe and back restores the drawings (round trip, no stale overlays)", async () => {
    const { api, calls } = spyApi();
    const sid = await bootSession(api);
    await api.putChart(sid, "BTCUSDT", "1h", { shapes: [shape("h1"), shape("h2")] });
    await api.putChart(sid, "BTCUSDT", "4h", { shapes: [shape("f1", "4h")] });

    switchChart("BTCUSDT", "4h");
    // Old drawings are cleared synchronously while the 4h doc loads.
    expect(ids()).toEqual([]);
    expect(useChartHistoryStore.getState().loadingKey).toBe(currentChartKey());
    await flushAsync();
    expect(ids()).toEqual(["f1"]);

    switchChart("BTCUSDT", "1h");
    await flushAsync();
    expect(ids()).toEqual(["h1", "h2"]);

    switchChart("BTCUSDT", "30m");
    await flushAsync();
    expect(ids()).toEqual([]); // 404 → clean
    expect(calls.put.filter((c) => c.key !== "BTCUSDT|1h" && c.key !== "BTCUSDT|4h")).toHaveLength(0);
  });

  it("a pending edit is saved before switching away", async () => {
    const { api, calls } = spyApi();
    const sid = await bootSession(api);
    await api.putChart(sid, "BTCUSDT", "1h", { shapes: [shape("h1")] });
    switchChart("BTCUSDT", "4h");
    await flushAsync();
    switchChart("BTCUSDT", "1h");
    await flushAsync();
    const before = calls.put.length;
    useShapeStore.getState().keep("h1");
    switchChart("BTCUSDT", "4h"); // before the debounce fires
    await flushAsync();
    expect(calls.put.length).toBe(before + 1);
    expect(calls.put.at(-1)?.key).toBe("BTCUSDT|1h");
    const saved = await api.getChart(sid, "BTCUSDT", "1h");
    expect(saved.shapes[0]?.kept).toBe(true);
  });

  it("pins survive a reload: session re-activation paints the saved kept shape", async () => {
    const { api } = spyApi();
    const sid = await bootSession(api);
    await api.putChart(sid, "BTCUSDT", "1h", { shapes: [shape("k", "1h", { kept: true }), shape("x")] });
    // Simulate a reload: activate the same session again from scratch.
    useShapeStore.getState().clearAll();
    await useCopilotSessionStore.getState().bootstrap();
    await flushAsync();
    expect(ids()).toEqual(["k", "x"]);
    useShapeStore.getState().replaceAgentShapes([shape("n")]);
    expect(ids()).toEqual(["k", "n"]);
  });

  it("409 → merge and retry once; a second conflict shows the Vietnamese notice", async () => {
    const inner = createMockChartStateApi();
    const { api, calls } = spyApi(inner);
    const sid = await bootSession(api);
    await inner.putChart(sid, "BTCUSDT", "1h", { shapes: [shape("h1")] });
    switchChart("BTCUSDT", "4h");
    await flushAsync();
    switchChart("BTCUSDT", "1h");
    await flushAsync();
    // Someone else (another tab / analyze) saves revision 2 with a new AI shape.
    await inner.putChart(sid, "BTCUSDT", "1h", { shapes: [shape("srv")], revision: 1 });

    useShapeStore.getState().addCommitted(shape("mine", "1h", { source: "human", origin: "user" }));
    await new Promise((r) => setTimeout(r, CHART_SAVE_DEBOUNCE_MS + 20));
    await flushAsync();
    // PUT rev 1 → 409, merged PUT rev 2 → ok.
    expect(calls.put.slice(-2).map((c) => c.body.revision)).toEqual([1, 2]);
    expect(ids()).toEqual(["srv", "mine"]);
    expect(useChartHistoryStore.getState().notice).toBeNull();

    // Always-conflicting server: retry once, then notice.
    const conflicting: ChartStateApi = {
      ...api,
      putChart: async () => {
        calls.put.push({ key: "conflict", body: {} });
        throw new CopilotApiError(409, conflictFixture as never, "revision_conflict");
      },
    };
    configureChartHistory({ api: conflicting });
    const n = calls.put.length;
    useShapeStore.getState().keep("srv");
    await new Promise((r) => setTimeout(r, CHART_SAVE_DEBOUNCE_MS + 20));
    await flushAsync();
    expect(calls.put.length - n).toBe(2);
    expect(useChartHistoryStore.getState().notice).toBe(CHART_HISTORY_CONFLICT);
  });

  it("413 shows the Vietnamese too-large notice", async () => {
    const { api } = spyApi();
    await bootSession(api);
    configureChartHistory({
      api: {
        ...api,
        putChart: async () => {
          throw new CopilotApiError(413, { code: "chart_state_too_large", limit: { shapes: 200 } } as never, "x");
        },
      },
    });
    useShapeStore.getState().addCommitted(shape("u1", "1h", { source: "human", origin: "user" }));
    await new Promise((r) => setTimeout(r, CHART_SAVE_DEBOUNCE_MS + 20));
    await flushAsync();
    expect(useChartHistoryStore.getState().notice).toMatch(/Biểu đồ quá lớn để lưu \(giới hạn: shapes 200\)/);
  });

  it("legacy session (no doc yet): message shapes for this chart are kept and saved as a new doc", async () => {
    const { api, calls } = spyApi();
    const sid = await bootSession(api);
    const session = useCopilotSessionStore.getState().sessionCache[sid]!;
    const legacy = {
      ...session,
      id: sid,
      messages: [
        {
          id: "m1",
          role: "assistant" as const,
          content: "x",
          model_id: null,
          created_at: 1,
          shapes: [shape("old1"), shape("other_tf", "4h")],
          markers: [],
        },
      ],
    };
    useCopilotSessionStore.setState({ sessionCache: { [sid]: legacy }, activeSessionId: "other" });
    await useCopilotSessionStore.getState().switchSession(sid);
    await flushAsync();
    expect(ids()).toEqual(["old1"]);
    expect(calls.put.at(-1)).toMatchObject({ key: "BTCUSDT|1h" });
    expect(calls.put.at(-1)?.body.revision).toBeUndefined();
  });
});

describe("session banner root cause ('Không lưu được phiên' with 200 PATCHes)", () => {
  it("parses the backend's session dump where messages carry meta: null", () => {
    // Shape of `CopilotSession.model_dump(by_alias=True)` from apps/copilot (pydantic dumps None).
    const dump = {
      id: "s1",
      title: "Phiên mới",
      created_at: 1,
      updated_at: 2,
      model_id: "provider-a/model-alpha",
      reasoning_effort: null,
      intent: null,
      chart: { symbol: "BTCUSDT", interval: "1h", from: 0, to: 0, candle_count: 200 },
      messages: [
        { id: "m1", role: "user", content: "hi", model_id: null, shapes: [], markers: [], created_at: 1, meta: null },
        {
          id: "m2",
          role: "assistant",
          content: "x",
          model_id: null,
          shapes: [],
          markers: [],
          created_at: 1,
          meta: { candle_count_used: null, clamped: null },
        },
        {
          id: "m3",
          role: "assistant",
          content: "y",
          model_id: null,
          shapes: [],
          markers: [],
          created_at: 1,
          meta: { candle_count_used: 200, clamped: false },
        },
      ],
    };
    const parsed = CopilotSessionApiSchema.parse(dump);
    expect(parsed.messages.map((m) => m.meta)).toEqual([
      undefined,
      undefined,
      { candle_count_used: 200, clamped: false },
    ]);
  });
});
