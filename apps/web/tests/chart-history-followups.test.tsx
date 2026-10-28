import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { ChartHistoryBar } from "../components/chart-history-bar";
import { CopilotReasoningControl } from "../components/copilot/copilot-reasoning-control";
import { reasoningEffortForAnalyze } from "../lib/copilot-reasoning";
import type { CopilotModelRecord } from "../lib/copilot-schema";
import {
  chartSaveRetryDelay,
  chartSavesSettled,
  classifyChartSaveError,
  configureChartHistory,
  currentChartKey,
  resetChartHistoryForTests,
  saveChartNow,
  switchChart,
  useChartHistoryStore,
} from "../lib/chart-history";
import {
  chartTooLargeNotice,
  createMockChartStateApi,
  sanitizeChartPutBody,
  type ChartStateApi,
} from "../lib/chart-state";
import { CopilotApiError, createCopilotApi, resetCopilotApiMockSessionsForTests } from "../lib/copilot-api";
import { clearCopilotModelsCache, loadCopilotModels } from "../lib/copilot-models-cache";
import {
  CHART_HISTORY_DUPLICATE_ID,
  CHART_HISTORY_INVALID,
  CHART_HISTORY_INVALID_INTERVAL,
  CHART_HISTORY_INVALID_NUMBER,
  CHART_HISTORY_INVALID_VIEW,
  CHART_HISTORY_REQUEST_TOO_LARGE,
  CHART_HISTORY_SAVE_FAILED,
  CHART_HISTORY_UNSAVED,
} from "../lib/copilot-strings";
import { mapShapeToPixels, mapZoneToRect } from "../lib/overlay-map";
import type { Candle, PatternShape } from "../lib/pattern-shape";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import { useMarkerStore } from "../lib/stores/marker-store";
import { useShapeStore } from "../lib/stores/shape-store";
import { cleanSummaryText } from "../lib/summary-text";
import { filterShapesToClosedTimes } from "../lib/use-copilot";
import { capitalizeFirst, evidenceListItemText } from "../lib/vi-evidence";

const userShape = (id: string, price = 1): PatternShape => ({
  id,
  symbol: "BTCUSDT",
  interval: "1h",
  kind: "trendline",
  name: "Support trendline",
  status: "committed",
  source: "human",
  confidence: 1,
  points: [
    { time: 1_710_000_000, price },
    { time: 1_710_007_200, price: price + 1 },
  ],
  priceLow: null,
  priceHigh: null,
  origin: "user",
  kept: false,
  edited: false,
});

const ids = () => useShapeStore.getState().shapes.map((s) => s.id);

/** Mock contract API whose PUTs fail with the queued errors first. */
function failingApi(failures: unknown[]) {
  const inner = createMockChartStateApi();
  const puts: string[][] = [];
  const api: ChartStateApi = {
    ...inner,
    putChart: async (sid, sym, tf, body) => {
      puts.push(body.shapes.map((s) => s.id));
      const next = failures.shift();
      if (next) throw next;
      return inner.putChart(sid, sym, tf, body);
    },
  };
  return { api, inner, puts };
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

const http = (status: number, code = "x") => new CopilotApiError(status, { code } as never, code);

describe("(1) chart save retry with backoff on 5xx / network", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("backoff is 2 s, 4 s, 8 s … capped at 60 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(chartSaveRetryDelay)).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000,
    ]);
  });

  it("503 then network error: 'chưa lưu' while retrying, cleared once saved; local edits stay", async () => {
    const { api, inner, puts } = failingApi([http(503), new TypeError("Failed to fetch")]);
    const sid = await bootSession(api);
    const key = currentChartKey()!;
    useShapeStore.getState().setChartShapes([userShape("u1")]);
    vi.useFakeTimers();
    await saveChartNow(key);
    expect(useChartHistoryStore.getState().unsaved[key]).toBe("retrying");
    expect(useChartHistoryStore.getState().notice).toBeNull(); // small state only, no banner
    expect(ids()).toEqual(["u1"]);

    // An edit while unsaved: the retry sends the newest local state.
    useShapeStore.getState().setChartShapes([userShape("u1"), userShape("u2")]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(puts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushAsync();
    expect(puts).toHaveLength(2); // network error → next retry in 4 s
    expect(useChartHistoryStore.getState().unsaved[key]).toBe("retrying");
    await vi.advanceTimersByTimeAsync(4000);
    await flushAsync();
    expect(puts).toEqual([["u1"], ["u1", "u2"], ["u1", "u2"]]);
    expect(useChartHistoryStore.getState().unsaved[key]).toBeUndefined();
    expect((await inner.getChart(sid, "BTCUSDT", "1h")).shapes.map((s) => s.id)).toEqual(["u1", "u2"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(puts).toHaveLength(3); // stopped once saved
  });

  it("switching away and back while unsaved keeps showing the local edits", async () => {
    const { api, inner } = failingApi([http(502), http(502)]);
    const sid = await bootSession(api);
    await inner.putChart(sid, "BTCUSDT", "4h", { shapes: [{ ...userShape("f1"), interval: "4h" }] });
    const key = currentChartKey()!;
    useShapeStore.getState().setChartShapes([userShape("u1")]);
    vi.useFakeTimers();
    await saveChartNow(key);
    switchChart("BTCUSDT", "4h");
    await flushAsync();
    expect(ids()).toEqual(["f1"]);
    switchChart("BTCUSDT", "1h");
    await flushAsync();
    expect(ids()).toEqual(["u1"]); // not the (missing) server doc
    expect(useChartHistoryStore.getState().unsaved[key]).toBe("retrying");
  });

  it("a retry that hits 409 reuses the merge (server AI shapes + local pins)", async () => {
    const { api, inner, puts } = failingApi([http(500)]);
    const sid = await bootSession(api);
    const key = currentChartKey()!;
    useShapeStore.getState().setChartShapes([userShape("u1")]);
    vi.useFakeTimers();
    await saveChartNow(key);
    // Meanwhile an analyze run saved server-side.
    await inner.putChart(sid, "BTCUSDT", "1h", {
      shapes: [{ ...userShape("ai1"), source: "agent", origin: "ai" }],
    });
    await vi.advanceTimersByTimeAsync(2000);
    await flushAsync();
    expect(puts.at(-1)?.sort()).toEqual(["ai1", "u1"]);
    expect(useChartHistoryStore.getState().unsaved[key]).toBeUndefined();
    expect(ids().sort()).toEqual(["ai1", "u1"]);
  });
});

describe("save errors that never fix themselves: Vietnamese notice, no retry, local state kept", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const body = (status: number, b: Record<string, unknown>) =>
    new CopilotApiError(status, b as never, String(b.code ?? "x"));

  it.each([
    ["400 malformed JSON", body(400, { code: "invalid_json" }), CHART_HISTORY_INVALID],
    ["401 (unused; generic)", body(401, { code: "unauthorized" }), CHART_HISTORY_SAVE_FAILED],
    ["403 (unused; generic)", body(403, { code: "forbidden" }), CHART_HISTORY_SAVE_FAILED],
    [
      "413 chart_state_too_large with a Vietnamese message",
      body(413, { code: "chart_state_too_large", limit: 200, field: "shapes", message: "Biểu đồ có quá nhiều hình (tối đa 200)." }),
      "Biểu đồ có quá nhiều hình (tối đa 200).",
    ],
    [
      "413 chart_state_too_large without message → field + limit",
      body(413, { code: "chart_state_too_large", limit: 200, field: "shapes" }),
      "Biểu đồ quá lớn để lưu (giới hạn: số hình 200) — hãy xoá bớt hình hoặc điểm neo.",
    ],
    ["413 request_too_large", body(413, { code: "request_too_large", message: "Request body too large" }), CHART_HISTORY_REQUEST_TOO_LARGE],
    ["422 invalid_number", body(422, { code: "invalid_number" }), CHART_HISTORY_INVALID_NUMBER],
    ["422 invalid_view_range", body(422, { code: "invalid_view_range" }), CHART_HISTORY_INVALID_VIEW],
    ["422 duplicate_shape_id", body(422, { code: "duplicate_shape_id" }), CHART_HISTORY_DUPLICATE_ID],
    ["422 invalid_interval", body(422, { code: "invalid_interval" }), CHART_HISTORY_INVALID_INTERVAL],
    ["422 other", body(422, { code: "validation_error" }), CHART_HISTORY_INVALID],
    [
      "422 other code with a Vietnamese message",
      body(422, { code: "chart_key_mismatch", message: "Hình vẽ không thuộc biểu đồ này" }),
      "Máy chủ từ chối biểu đồ: Hình vẽ không thuộc biểu đồ này — hình vẽ vẫn giữ trên thiết bị.",
    ],
  ] as const)("%s", async (_name, error, notice) => {
    const { api, puts } = failingApi([error, error, error]);
    await bootSession(api);
    const key = currentChartKey()!;
    useShapeStore.getState().setChartShapes([userShape("u1")]);
    vi.useFakeTimers();
    await saveChartNow(key);
    await vi.advanceTimersByTimeAsync(180_000);
    await flushAsync();
    expect(puts).toHaveLength(1);
    expect(useChartHistoryStore.getState().notice).toBe(notice);
    expect(useChartHistoryStore.getState().unsaved[key]).toBe("failed");
    expect(ids()).toEqual(["u1"]);
  });

  it("classifies errors", () => {
    expect(classifyChartSaveError(new TypeError("Failed to fetch"))).toBe("retry");
    expect(classifyChartSaveError(http(504))).toBe("retry");
    expect(classifyChartSaveError(http(503, "db_unavailable"))).toBe("retry");
    expect(classifyChartSaveError(http(400, "invalid_json"))).toBe("invalid");
    expect(classifyChartSaveError(http(401))).toBe("other");
    expect(classifyChartSaveError(http(404, "session_not_found"))).toBe("session_gone");
    expect(classifyChartSaveError(new CopilotApiError(404, { error: "session not found" }, "x"))).toBe("session_gone");
    expect(classifyChartSaveError(http(404, "x"))).toBe("no_route");
    expect(classifyChartSaveError(http(404, "chart_state_not_found"))).toBe("other");
  });
});

const API_ERRORS = path.resolve(__dirname, "../../copilot/tests/fixtures/wire/api_errors.json");

describe("413 envelopes from the backend fixture (apps/copilot/tests/fixtures/wire/api_errors.json)", () => {
  it.skipIf(!existsSync(API_ERRORS))("shows the server's Vietnamese message for both caps", () => {
    const fixture = JSON.parse(readFileSync(API_ERRORS, "utf8")) as Record<string, { status: number; body: Record<string, unknown> }>;
    for (const name of ["chart_state_too_large", "request_too_large"]) {
      const { status, body } = fixture[name]!;
      const err = new CopilotApiError(status, body as never, name);
      expect(chartTooLargeNotice(err), name).toBe(body.message);
      expect(classifyChartSaveError(err), name).toBe("too_large");
    }
  });
});

describe("(d) PUT body is sanitized before sending (prevents 422s)", () => {
  it("drops NaN/Inf shapes and markers, clamps confidence, dedupes ids, orders the view", () => {
    const ok = userShape("a");
    const out = sanitizeChartPutBody({
      shapes: [
        ok,
        { ...userShape("a"), name: "dup" },
        { ...userShape("nan"), points: [{ time: Number.NaN, price: 1 }, { time: 1, price: 2 }] },
        { ...userShape("inf"), kind: "zone", priceLow: 1, priceHigh: Number.POSITIVE_INFINITY },
        { ...userShape("conf"), confidence: 7 },
      ],
      markers: [
        { id: "m1", symbol: "BTCUSDT", interval: "1h", time: 1_710_000_000, side: "buy", position: "belowBar", shape: "arrowUp", confidence: Number.NaN, source: "agent" },
        { id: "m2", symbol: "BTCUSDT", interval: "1h", time: Number.NaN, side: "buy", position: "belowBar", shape: "arrowUp", confidence: 0.5, source: "agent" },
      ],
      view: { from: 1_710_007_200.7, to: 1_710_000_000.2 },
    });
    expect(out.shapes.map((s) => s.id)).toEqual(["a", "conf"]);
    expect(out.shapes[0]?.name).toBe("Support trendline"); // first wins
    expect(out.shapes[1]?.confidence).toBe(1);
    expect(out.markers?.map((m) => [m.id, m.confidence])).toEqual([["m1", 0]]);
    expect(out.view).toEqual({ from: 1_710_000_000, to: 1_710_007_201 });
    expect(sanitizeChartPutBody({ shapes: [], view: { from: Number.NaN, to: 1 } })).not.toHaveProperty("view");
  });

  it("the controller sends the sanitized body", async () => {
    const { api, puts } = failingApi([]);
    await bootSession(api);
    useShapeStore.getState().setChartShapes([userShape("u1"), userShape("bad", Number.NaN)]);
    await saveChartNow(currentChartKey()!);
    await flushAsync();
    expect(puts).toEqual([["u1"]]);
  });
});

describe("'chưa lưu' badge and summary text in the history bar", () => {
  it("shows the badge for the current chart and strips progress lines from the summary (4)", async () => {
    await bootSession(createMockChartStateApi());
    const key = currentChartKey()!;
    useChartHistoryStore.setState({
      unsaved: { [key]: "retrying" },
      docs: {
        [key]: {
          revision: 1,
          analysis: null,
          view: null,
          analyzed_at: 1,
          savedShapeIds: [],
          summary_text:
            "Đang phân tích BTCUSDT 1h (299 nến đã đóng)…\n\nMô hình đã xong. Đang dựng lớp phủ…\n\nXu hướng tăng, giữ trên EMA50.",
        },
      },
    });
    render(<ChartHistoryBar />);
    expect(screen.getByTestId("chart-history-unsaved").textContent).toContain(CHART_HISTORY_UNSAVED);
    const bar = screen.getByTestId("chart-history-bar").textContent ?? "";
    expect(bar).toContain("Tóm tắt: Xu hướng tăng, giữ trên EMA50.");
    expect(bar).not.toMatch(/Đang phân tích|Mô hình đã xong/);
  });
});

describe("(4) summary_text progress lines", () => {
  it("are stripped; real content and the N25 note stay", () => {
    expect(
      cleanSummaryText(
        "Đang phân tích ETHUSDT 4h (120 nến đã đóng)…\n\nStub server summary.\nMô hình đã xong. Đang dựng lớp phủ…\n\n\nKhông vẽ được hình mới nào (nến chưa đóng) — giữ các hình trước.",
      ),
    ).toBe("Stub server summary.\n\nKhông vẽ được hình mới nào (nến chưa đóng) — giữ các hình trước.");
    expect(cleanSummaryText("Đang phân tích BTCUSDT 1h (3 nến đã đóng)…")).toBeNull();
    expect(cleanSummaryText(null)).toBeNull();
  });
});

describe("(6) Fib level lines with the last bar first", () => {
  const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
    time: 1_710_000_000 + i * 3600,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 1,
  }));
  const last = candles.at(-1)!.time;
  const first = candles[2]!.time;
  const fib: PatternShape = {
    ...userShape("fib_0.5"),
    name: "Fib 0.5",
    source: "agent",
    origin: "ai",
    points: [
      { time: last, price: 100 },
      { time: first, price: 100 },
    ],
  };
  const api = { timeToCoordinate: (t: number) => (t - candles[0]!.time) / 36, priceToCoordinate: (p: number) => 500 - p };

  it("pass the closed-candle filter and map to the same horizontal segment as the sorted order", () => {
    const allowed = new Set(candles.map((c) => c.time));
    const { valid } = filterShapesToClosedTimes([fib], allowed, candles, "1h");
    expect(valid.map((s) => s.id)).toEqual(["fib_0.5"]);
    const px = mapShapeToPixels(fib, api);
    const sorted = mapShapeToPixels({ ...fib, points: [...fib.points].reverse() }, api);
    expect(px).toHaveLength(2);
    expect(new Set(px.map((p) => p.x))).toEqual(new Set(sorted.map((p) => p.x)));
    expect(px.every((p) => p.y === 400)).toBe(true);
    // Zones (Fib pocket) use min/max time, so reversed points give the same rect.
    const zone = { ...fib, kind: "zone" as const, priceLow: 90, priceHigh: 110 };
    expect(mapZoneToRect(zone, api, 1000)).toEqual(
      mapZoneToRect({ ...zone, points: [...zone.points].reverse() }, api, 1000),
    );
  });
});

describe("(7) evidence list items are capitalized", () => {
  it("first letter upper-cased, Vietnamese-aware; digits/symbols unchanged", () => {
    expect(capitalizeFirst("chỉ 2 lần chạm")).toBe("Chỉ 2 lần chạm");
    expect(capitalizeFirst("đổi vai theo giá đóng cửa")).toBe("Đổi vai theo giá đóng cửa");
    expect(capitalizeFirst("ATR14 ≈ 295")).toBe("ATR14 ≈ 295");
    expect(capitalizeFirst("2 lần chạm")).toBe("2 lần chạm");
    expect(evidenceListItemText("only 2 touches")).toBe("Chỉ 2 lần chạm");
    expect(evidenceListItemText({ code: "c", params: {}, text: "giá trên EMA200" })).toBe("Giá trên EMA200");
  });
});

describe("(8) non-reasoning models (reasoning_efforts [])", () => {
  const model = {
    id: "agentrouter/deepseek-v4-flash",
    supports_reasoning: true,
    reasoning_efforts: [],
  } as unknown as CopilotModelRecord;

  it("hide the effort control and omit the effort on analyze", () => {
    const { container } = render(
      <CopilotReasoningControl model={model} reasoningEffort="low" onChange={() => {}} />,
    );
    expect(container.textContent).toBe("");
    expect(reasoningEffortForAnalyze(model, "low")).toBeNull();
    expect(reasoningEffortForAnalyze(model, "high")).toBeNull();
  });
});
