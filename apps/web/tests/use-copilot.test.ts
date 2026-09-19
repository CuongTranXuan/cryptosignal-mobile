import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMarker, Candle, PatternShape } from "../lib/pattern-shape";
import { useChartStore } from "../lib/stores/chart-store";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useShapeStore } from "../lib/stores/shape-store";
import { useAiStore } from "../lib/stores/ai-store";
import {
  AUTO_DRAW_PROMPT,
  COPILOT_ERROR,
  COPILOT_ERROR_CREDITS_EXHAUSTED,
  COPILOT_ERROR_RATE_LIMITED,
  COPILOT_ERROR_UNAUTHORIZED,
  HEAD_SHOULDERS_PROMPT,
  TRIANGLES_PROMPT,
} from "../lib/copilot-strings";
import { createCopilotClient } from "../lib/use-copilot";

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

const validShape = (id = "s1"): PatternShape => ({
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

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function resetStores() {
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
}

describe("use-copilot / createCopilotClient", () => {
  beforeEach(() => {
    resetStores();
    vi.restoreAllMocks();
  });

  it("exposes exact preset prompt strings", () => {
    expect(TRIANGLES_PROMPT).toBe(
      "Tìm tam giác cân trong cửa sổ nến đã đóng này. Return PatternShape polyline(s). Reply and summarize in English; output all text in English.",
    );
    expect(HEAD_SHOULDERS_PROMPT).toBe(
      "Tìm mẫu vai đầu vai trong cửa sổ nến đã đóng này. Return PatternShape polyline(s). Reply and summarize in English; output all text in English.",
    );
    expect(AUTO_DRAW_PROMPT).toBe(
      "Tự vẽ: cập nhật mẫu hình cho nến đóng mới nhất. Update patterns for the latest closed candle. Reply and summarize in English; output all text in English.",
    );
  });

  it("streams text+shapes into agent message and setPreview", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([
        sseChunk("text", { delta: "Found " }),
        sseChunk("text", { delta: "a triangle" }),
        sseChunk("shapes", { shapes: [validShape("tri-1")] }),
        sseChunk("done", {}),
      ]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      baseUrl: "http://127.0.0.1:8000",
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });

    await client.analyze(TRIANGLES_PROMPT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("http://127.0.0.1:8000/v1/copilot/analyze");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(String(call[1].body));
    expect(body.prompt).toContain(TRIANGLES_PROMPT);
    expect(body.prompt).toContain("[Analysis window]");
    expect(body.closedCandles).toEqual([c0, c1, c2]);
    expect(body.from).toBe(c0.time);
    expect(body.to).toBe(c2.time);

    const ai = useAiStore.getState();
    expect(ai.inFlight).toBe(false);
    expect(ai.messages).toEqual([
      expect.objectContaining({ role: "user", content: TRIANGLES_PROMPT }),
      expect.objectContaining({
        role: "agent",
        content: expect.stringMatching(/Found a triangle[\s\S]*Đã vẽ 1 hình trên biểu đồ/),
      }),
    ]);
    expect(useShapeStore.getState().previews().map((s) => s.id)).toEqual([]);
    expect(useShapeStore.getState().committed().map((s) => s.id)).toEqual(["tri-1"]);
    expect(body.existingMarkers).toEqual([]);
    expect(useMarkerStore.getState().markers).toEqual([]);
  });

  it("streams markers into the marker store without touching shapes", async () => {
    const committed = { ...validShape("keep"), status: "committed" as const };
    useShapeStore.setState({ shapes: [committed], selectedId: null });

    const marker: AgentMarker = {
      id: "mrk-1",
      symbol: "BTCUSDT",
      interval: "1h",
      time: c1.time,
      side: "buy",
      position: "belowBar",
      shape: "arrowUp",
      confidence: 0.7,
      source: "agent",
    };

    const fetchMock = vi.fn(async () =>
      streamResponse([
        sseChunk("shapes", { shapes: [validShape("tri-1")] }),
        sseChunk("markers", { markers: [marker, { ...marker, id: "off", time: 999 }] }),
        sseChunk("done", {}),
      ]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });

    await client.analyze("signals");

    expect(useShapeStore.getState().previews().map((s) => s.id)).toEqual([]);
    expect(useShapeStore.getState().committed().map((s) => s.id).sort()).toEqual(
      ["keep", "tri-1"].sort(),
    );
    expect(useMarkerStore.getState().markers.map((m) => m.id)).toEqual(["mrk-1"]);
    const agentMsg = useAiStore.getState().messages.find((m) => m.role === "agent");
    expect(agentMsg?.content).toContain("Đã vẽ 1 hình trên biểu đồ");
    expect(agentMsg?.content).toContain("Đã đặt 1 marker trên biểu đồ.");
    expect(useAiStore.getState().messages.find((m) => m.role === "agent")?.content).toContain("Bỏ qua");
  });

  it("error event fails without touching committed shapes or calling setPreview", async () => {
    const committed = { ...validShape("keep"), status: "committed" as const };
    useShapeStore.setState({ shapes: [committed], selectedId: null });

    const fetchMock = vi.fn(async () =>
      streamResponse([
        sseChunk("text", { delta: "oops" }),
        sseChunk("error", { message: "Copilot failed: provider unauthorized" }),
        sseChunk("done", {}),
      ]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });

    await client.analyze("find patterns");

    expect(useAiStore.getState().lastError).toBe("Copilot failed: provider unauthorized");
    expect(useAiStore.getState().inFlight).toBe(false);
    expect(useShapeStore.getState().committed()).toEqual([
      expect.objectContaining({ id: "keep", status: "committed" }),
    ]);
    expect(useShapeStore.getState().previews()).toHaveLength(0);
  });

  it("maps HTTP 401/402/403/429/503 to spec error strings", async () => {
    for (const [status, message] of [
      [401, COPILOT_ERROR_UNAUTHORIZED],
      [402, COPILOT_ERROR_CREDITS_EXHAUSTED],
      [403, COPILOT_ERROR_UNAUTHORIZED],
      [429, COPILOT_ERROR_RATE_LIMITED],
      [503, COPILOT_ERROR],
    ] as const) {
      resetStores();
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "x" }), { status }));
      const client = createCopilotClient({
        fetchImpl: fetchMock as unknown as typeof fetch,
        getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
      });
      await client.analyze("hi");
      expect(useAiStore.getState().lastError).toBe(message);
      expect(useAiStore.getState().inFlight).toBe(false);
    }
  });

  it("sends viewport-aligned closed candles and annotated prompt", async () => {
    const extra: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      extra.push({
        time: 1709852400 + i * 3600,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 1,
      });
    }
    const forming = c3Forming;
    useChartStore.setState({ candles: [...extra, c0, c1, c2, forming] });
    const closed = new Set([...extra, c0, c1, c2].map((c) => c.time));
    // Visible only the last few closed bars (c0..c2)
    const visible = { from: c0.time, to: c2.time };

    const fetchMock = vi.fn(async () =>
      streamResponse([
        sseChunk("text", { delta: "ok" }),
        sseChunk("done", {}),
      ]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => closed,
      getCoordApi: () =>
        ({
          timeToCoordinate: () => null,
          priceToCoordinate: () => null,
          coordinateToTime: () => null,
          coordinateToPrice: () => null,
          revealTimes: vi.fn(),
          getVisibleTimeRange: () => visible,
        }) as import("../lib/chart-api").ChartCoordinateApi,
    });

    await client.analyze("Find triangles in this window");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.from).toBeGreaterThanOrEqual(visible.from - 2 * 3600);
    expect(body.to).toBe(c2.time);
    expect(body.closedCandles.every((c: Candle) => c.time >= body.from && c.time <= body.to)).toBe(
      true,
    );
    expect(body.closedCandles.length).toBeLessThan(closed.size);
    expect(body.prompt).toContain("this window");
    expect(body.prompt).toContain("mode=viewport");
  });

  it("widens closed candles when the user names full history", async () => {
    const extra: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      extra.push({
        time: 1709852400 + i * 3600,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 1,
      });
    }
    useChartStore.setState({ candles: [...extra, c0, c1, c2, c3Forming] });
    const closed = new Set([...extra, c0, c1, c2].map((c) => c.time));
    const visible = { from: c0.time, to: c2.time };

    const fetchMock = vi.fn(async () =>
      streamResponse([
        sseChunk("text", { delta: "ok" }),
        sseChunk("done", {}),
      ]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => closed,
      getCoordApi: () =>
        ({
          timeToCoordinate: () => null,
          priceToCoordinate: () => null,
          coordinateToTime: () => null,
          coordinateToPrice: () => null,
          revealTimes: vi.fn(),
          getVisibleTimeRange: () => visible,
        }) as import("../lib/chart-api").ChartCoordinateApi,
    });

    await client.analyze("Draw the major trend across full history");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.closedCandles.length).toBe(closed.size);
    expect(body.from).toBe(extra[0]!.time);
    expect(body.to).toBe(c2.time);
    expect(body.prompt).toContain("mode=all");
    expect(body.prompt).toMatch(/full\/loaded history|named another range/i);
  });

  it("does not call analyze when only a forming candle exists", async () => {
    useChartStore.setState({ candles: [c3Forming] });
    const fetchMock = vi.fn();
    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => new Set(),
    });
    await client.analyze("hi");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAiStore.getState().inFlight).toBe(false);
  });

  it("Auto-Draw coalesce queues while inFlight and runs one follow-up on finish", async () => {
    let resolveFirst!: (value: Response) => void;
    const firstPromise = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return firstPromise;
      return streamResponse([
        sseChunk("text", { delta: "follow-up" }),
        sseChunk("shapes", { shapes: [validShape("auto-2")] }),
        sseChunk("done", {}),
      ]);
    });

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });

    useAiStore.getState().setMode("auto");

    const first = client.analyze("manual start");
    await vi.waitFor(() => expect(useAiStore.getState().inFlight).toBe(true));

    client.onClosedKline();
    client.onClosedKline();

    resolveFirst(
      streamResponse([
        sseChunk("text", { delta: "first" }),
        sseChunk("shapes", { shapes: [validShape("auto-1")] }),
        sseChunk("done", {}),
      ]),
    );
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(useAiStore.getState().inFlight).toBe(false));

    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map((c) =>
      JSON.parse(String(c[1].body)),
    );
    expect(bodies[1]?.prompt).toContain(AUTO_DRAW_PROMPT);
    expect(useShapeStore.getState().previews().map((s) => s.id)).toEqual([]);
    expect(useShapeStore.getState().committed().map((s) => s.id)).toContain("auto-2");
  });

  it("superseded done finishes without failure and does not clear previews", async () => {
    useShapeStore.getState().setPreview([validShape("prior")]);

    const fetchMock = vi.fn(async () =>
      streamResponse([sseChunk("done", { superseded: true })]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });

    await client.analyze("queued waiter");

    expect(useAiStore.getState().lastError).toBeNull();
    expect(useAiStore.getState().inFlight).toBe(false);
    expect(useShapeStore.getState().previews().map((s) => s.id)).toEqual(["prior"]);
  });

  it("extendRange merges fetched klines using from/to ms range", async () => {
    const fetchKlines = vi.fn(async () => ({
      candles: [
        { time: 1709996400, open: 0.5, high: 1, low: 0.4, close: 0.9, volume: 3 },
        c1,
      ],
      closeTimesMs: [1709999999999, 1710003599999],
    }));

    const fetchMock = vi.fn(async () =>
      streamResponse([
        sseChunk("shapes", { shapes: [validShape("x")] }),
        sseChunk("extendRange", { from: 1709996400, to: 1710000000 }),
        sseChunk("done", {}),
      ]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      fetchKlines,
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });

    await client.analyze("extend");

    expect(fetchKlines).toHaveBeenCalledWith("BTCUSDT", "1h", 1000, {
      startTimeMs: 1709996400 * 1000,
      endTimeMs: 1710000000 * 1000,
    });
    const times = useChartStore.getState().candles.map((c) => c.time);
    expect(times[0]).toBe(1709996400);
    expect(times).toContain(c1.time);
    expect(times).toContain(c2.time);
  });

  it("drops shapes with points outside closed candle times", async () => {
    const outOfWindow = {
      ...validShape("off-window"),
      points: [
        { time: c1.time, price: 1 },
        { time: c2.time, price: 2 },
        { time: 9999999999, price: 1.5 },
      ],
    };

    const fetchMock = vi.fn(async () =>
      streamResponse([
        sseChunk("shapes", { shapes: [validShape("ok"), outOfWindow] }),
        sseChunk("done", {}),
      ]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });

    await client.analyze("filter times");

    expect(useShapeStore.getState().previews().map((s) => s.id)).toEqual([]);
    expect(useShapeStore.getState().committed().map((s) => s.id)).toEqual(["ok"]);
    expect(useAiStore.getState().lastError).toBeNull();
    const agentMsg = useAiStore.getState().messages.find((m) => m.role === "agent");
    expect(agentMsg?.content).toContain("Đã vẽ 1 hình trên biểu đồ");
    expect(agentMsg?.content).toContain("Bỏ qua");
  });

  it("clearAll shapes when chart shapesResetSignal increments", async () => {
    useShapeStore.getState().setPreview([validShape("gone")]);
    useMarkerStore.getState().setMarkers([
      {
        id: "mrk-gone",
        symbol: "BTCUSDT",
        interval: "1h",
        time: c1.time,
        side: "buy",
        position: "belowBar",
        shape: "arrowUp",
        confidence: 0.5,
        source: "agent",
      },
    ]);
    const client = createCopilotClient({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    client.watchShapesReset();
    useChartStore.getState().resetShapesSignal();
    await vi.waitFor(() => expect(useShapeStore.getState().shapes).toHaveLength(0));
    expect(useMarkerStore.getState().markers).toHaveLength(0);
    client.dispose();
  });

  it("drops invalid shapes and notes ids in lastError", async () => {
    const bad = {
      id: "bad-poly",
      symbol: "BTCUSDT",
      interval: "1h",
      kind: "polyline",
      name: "Broken",
      status: "preview",
      source: "agent",
      confidence: 0.5,
      points: [{ time: 1, price: 1 }],
      priceLow: null,
      priceHigh: null,
    };

    const fetchMock = vi.fn(async () =>
      streamResponse([
        sseChunk("shapes", { shapes: [validShape("ok"), bad] }),
        sseChunk("done", {}),
      ]),
    );

    const client = createCopilotClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getClosedTimes: () => new Set([c0.time, c1.time, c2.time]),
    });

    await client.analyze("parse");

    expect(useShapeStore.getState().previews().map((s) => s.id)).toEqual([]);
    expect(useShapeStore.getState().committed().map((s) => s.id)).toEqual(["ok"]);
    expect(useAiStore.getState().lastError).toBeNull();
    expect(
      useAiStore.getState().messages.find((m) => m.role === "agent")?.content,
    ).toContain("Bỏ qua");
  });
});
