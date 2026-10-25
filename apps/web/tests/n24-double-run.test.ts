import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotApi, resetCopilotApiMockSessionsForTests } from "../lib/copilot-api";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import { copilotSkippedMarkers } from "../lib/copilot-strings";
import type { AgentMarker, Candle, PatternShape } from "../lib/pattern-shape";
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

const shape = (id: string, source: "agent" | "human" = "agent"): PatternShape => ({
  id,
  symbol: "BTCUSDT",
  interval: "1h",
  kind: "polyline",
  name: `Shape ${id}`,
  status: "preview",
  source,
  confidence: 0.7,
  points: [
    { time: candles[0]!.time, price: 1 },
    { time: candles[2]!.time, price: 2 },
  ],
  priceLow: null,
  priceHigh: null,
});

const anchor = (drawingId: string): AgentMarker => ({
  id: `anchor-${drawingId}`,
  symbol: "BTCUSDT",
  interval: "1h",
  time: candles[0]!.time,
  side: "neutral",
  position: "inBar",
  shape: "circle",
  label: "Neo",
  confidence: 0.7,
  source: "agent",
  drawing_id: drawingId,
});

const SIX = ["drw_a", "drw_b", "drw_c", "drw_d", "drw_e", "drw_f"];

function sse(ids: string[], extraMarkers: unknown[] = []): Response {
  const body =
    `event: shapes\ndata: ${JSON.stringify({ shapes: ids.map((id) => shape(id)) })}\n\n` +
    `event: markers\ndata: ${JSON.stringify({ markers: [...ids.map(anchor), ...extraMarkers] })}\n\n` +
    "event: done\ndata: {}\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function runAnalyze(
  ids: string[],
  extraMarkers: unknown[] = [],
): Promise<Record<string, unknown>> {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => sse(ids, extraMarkers));
  const client = createCopilotClient({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getClosedTimes: () => closed,
  });
  await client.analyze("phân tích cửa sổ này");
  return JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}"));
}

const shapeIds = () => useShapeStore.getState().shapes.map((s) => s.id);
const markerIds = () => useMarkerStore.getState().markers.map((m) => m.id);
const hasDuplicates = (ids: string[]) => new Set(ids).size !== ids.length;

describe("N24: repeated analyze runs replace AI overlays", () => {
  beforeEach(async () => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
    const api = createCopilotApi({ forceMock: true });
    clearCopilotModelsCache();
    await loadCopilotModels(api);
    useCopilotSessionStore.getState().setApi(api);
    await useCopilotSessionStore.getState().bootstrap();
    useChartStore.setState({ symbol: "BTCUSDT", interval: "1h", candles, connection: "live" });
    useAiStore.setState({ messages: [], inFlight: false, lastError: null });
    useShapeStore.getState().clearAll();
    useMarkerStore.getState().clearAll();
  });

  it("two identical runs leave 6 unique shapes and 6 unique anchors", async () => {
    await runAnalyze(SIX);
    await runAnalyze(SIX);
    expect(shapeIds()).toEqual(SIX);
    expect(hasDuplicates(shapeIds())).toBe(false);
    expect(useShapeStore.getState().committed()).toHaveLength(6);
    expect(markerIds()).toHaveLength(6);
    expect(hasDuplicates(markerIds())).toBe(false);
  });

  it("a run with different ids replaces the previous AI shapes and their anchors", async () => {
    await runAnalyze(SIX);
    await runAnalyze(["drw_x", "drw_y"]);
    expect(shapeIds()).toEqual(["drw_x", "drw_y"]);
    expect(markerIds()).toEqual(["anchor-drw_x", "anchor-drw_y"]);
  });

  it("kept, edited and user-drawn shapes survive a new run with their anchors", async () => {
    await runAnalyze(SIX);
    const store = useShapeStore.getState();
    store.pin("drw_a");
    store.patchPoints("drw_b", [
      { time: candles[0]!.time, price: 9 },
      { time: candles[1]!.time, price: 8 },
    ]);
    store.addCommitted(shape("human_1", "human"));

    await runAnalyze(["drw_b", "drw_x"]);

    expect(shapeIds().sort()).toEqual(["drw_a", "drw_b", "drw_x", "human_1"]);
    const edited = useShapeStore.getState().shapes.find((s) => s.id === "drw_b");
    expect(edited?.points[0]?.price).toBe(9);
    expect(markerIds().sort()).toEqual(["anchor-drw_a", "anchor-drw_b", "anchor-drw_x"]);
    expect(hasDuplicates(markerIds())).toBe(false);
  });

  it("an empty run clears unpinned AI shapes and drops their orphan anchors", async () => {
    await runAnalyze(SIX);
    useShapeStore.getState().pin("drw_c");
    await runAnalyze([]);
    expect(shapeIds()).toEqual(["drw_c"]);
    expect(markerIds()).toEqual(["anchor-drw_c"]);
  });

  it("dedupes repeated ids inside one run", async () => {
    await runAnalyze(["drw_a", "drw_a", "drw_b"]);
    expect(shapeIds()).toEqual(["drw_a", "drw_b"]);
    expect(markerIds()).toEqual(["anchor-drw_a", "anchor-drw_b"]);
  });

  it("second run sends existingShapes without server-only guardrail", async () => {
    await runAnalyze(["drw_a"]);
    useShapeStore.setState({
      shapes: useShapeStore.getState().shapes.map((s) => ({
        ...s,
        guardrail: { regime: "range", confidence: 0.7, evidence_against: [], invalidation: null },
      })),
    });
    const body = await runAnalyze(["drw_a"]);
    const existing = body.existingShapes as Record<string, unknown>[];
    expect(existing.map((s) => s.id)).toEqual(["drw_a"]);
    expect(existing[0]).not.toHaveProperty("guardrail");
  });

  it("reports invalid anchors as điểm neo", async () => {
    expect(copilotSkippedMarkers(2)).toBe("\n\n(Bỏ qua 2 điểm neo không hợp lệ.)");
    await runAnalyze(["drw_a"], [{ id: "broken" }]);
    const content = useAiStore.getState().messages.find((m) => m.role === "agent")?.content ?? "";
    expect(content).toContain("(Bỏ qua 1 điểm neo không hợp lệ.)");
  });
});
