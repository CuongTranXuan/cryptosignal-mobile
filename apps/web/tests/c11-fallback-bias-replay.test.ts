import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotApi } from "../lib/copilot-api";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import { LEGACY_SESSIONS_STORAGE_KEY } from "../lib/copilot-session-migration";
import { resetCopilotApiMockSessionsForTests } from "../lib/copilot-api";
import { createCopilotClient } from "../lib/use-copilot";
import { COPILOT_SERVER_PICKED_SHAPES } from "../lib/copilot-strings";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useShapeStore } from "../lib/stores/shape-store";
import type { Candle } from "../lib/pattern-shape";

const c0: Candle = {
  time: 1709996400,
  open: 0.8,
  high: 1.1,
  low: 0.7,
  close: 1.0,
  volume: 12,
};
const c1: Candle = {
  time: 1710000000,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
};
const c2: Candle = {
  time: 1710003600,
  open: 1.5,
  high: 2.5,
  low: 1.4,
  close: 2.0,
  volume: 8,
};
const c3Forming: Candle = {
  time: 1710007200,
  open: 2,
  high: 2.2,
  low: 1.9,
  close: 2.1,
  volume: 5,
};

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const validShape = (id: string) => ({
  id,
  symbol: "BTCUSDT",
  interval: "1h",
  kind: "polyline",
  name: "Triangle",
  status: "preview",
  source: "agent",
  confidence: 0.8,
  points: [
    { time: c0.time, price: 1 },
    { time: c1.time, price: 2 },
    { time: c2.time, price: 1.5 },
  ],
  priceLow: null,
  priceHigh: null,
});

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/c11-fallback-bias-replay.json",
);
const replay = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  events: [string, Record<string, unknown>][];
};

describe("C.11 fallback + bias conflict replay", () => {
  beforeEach(async () => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
    localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY);
    const api = createCopilotApi({ forceMock: true });
    clearCopilotModelsCache();
    await loadCopilotModels(api);
    useCopilotSessionStore.getState().setApi(api);
    await useCopilotSessionStore.getState().bootstrap();
    useChartStore.setState({
      symbol: "BTCUSDT",
      interval: "1h",
      candles: [c0, c1, c2, c3Forming],
      tickerPercent: null,
      connection: "live",
      shapesResetSignal: 0,
    });
    useShapeStore.setState({ shapes: [], selectedId: null });
    useMarkerStore.setState({ markers: [] });
    useAiStore.setState({
      mode: "manual",
      messages: [],
      inFlight: false,
      lastError: null,
      panelWidth: 360,
      health: null,
    });
    vi.restoreAllMocks();
  });

  it("emits one overlay announcement, no bias chat notice, no glued sentences", async () => {
    const wireShapes = [validShape("r1"), validShape("r2")];
    const chunks = replay.events.map(([event, data]) => {
      if (event === "shapes") {
        return sseChunk(event, { ...data, shapes: wireShapes });
      }
      return sseChunk(event, data);
    });

    const fetchMock = vi.fn(async () => streamResponse(chunks));
    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });
    await client.analyze("bearish bias prompt");

    const content = useAiStore.getState().messages.find((m) => m.role === "agent")?.content ?? "";
    expect(content).not.toMatch(/⚠\s*Xu hướng bạn chọn/);
    expect(content).not.toContain("Đã vẽ");
    expect((content.match(/Lớp phủ sẵn sàng/g) ?? []).length).toBe(1);
    expect(content).not.toMatch(/thị trường\.Mô hình/);
    expect(content).toContain("Mô hình đã xong");
    expect(content).toContain("Lưu ý:");

    const fallbackMatches = content.match(new RegExp(COPILOT_SERVER_PICKED_SHAPES, "g"));
    expect(fallbackMatches?.length ?? 0).toBe(1);

    expect(useCopilotSessionStore.getState().lastAnalyzeMeta?.validator_fallback).toBe(true);
    expect(useCopilotSessionStore.getState().lastAnalyzeMeta?.candle_count_requested).toBe(300);
  });
});
