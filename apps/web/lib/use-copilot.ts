import { mergeCandles } from "./binance";
import {
  AUTO_DRAW_PROMPT,
  COPILOT_ERROR,
  COPILOT_ERROR_CREDITS_EXHAUSTED,
  COPILOT_ERROR_RATE_LIMITED,
  COPILOT_ERROR_UNAUTHORIZED,
  copilotDrewShapes,
  copilotPlacedMarkers,
  copilotShapeSummaryLine,
  copilotSkippedMarkers,
  copilotSkippedShapes,
  COPILOT_SCROLLED_TO_OVERLAYS,
  mapCopilotSseError,
} from "./copilot-strings";
import { fetchKlines as defaultFetchKlines, type FetchKlines } from "./market-client";
import { coerceAgentMarker, coerceAgentShape } from "./normalize-agent-shape";
import {
  AgentMarkerSchema,
  PatternShapeSchema,
  type AgentMarker,
  type Candle,
  type PatternShape,
} from "./pattern-shape";
import {
  annotatePromptWithWindow,
  selectAnalysisCandles,
  timesInsideVisibleRange,
} from "./analysis-window";
import { useAiStore } from "./stores/ai-store";
import { useChartStore } from "./stores/chart-store";
import { useMarkerStore } from "./stores/marker-store";
import { useShapeStore } from "./stores/shape-store";

export {
  annotatePromptWithWindow,
  promptRequestsVisibleWindow,
  selectAnalysisCandles,
  timesInsideVisibleRange,
} from "./analysis-window";

export { AUTO_DRAW_PROMPT, HEAD_SHOULDERS_PROMPT, TRIANGLES_PROMPT } from "./copilot-strings";

/** Empty = same-origin (Next rewrite proxies to the local FastAPI copilot). */
const DEFAULT_BASE = "";

/** Render/Vercel: set NEXT_PUBLIC_COPILOT_URL to HTTPS origin only (no /v1). Paths: /v1/copilot/health, /v1/copilot/analyze. */

export type CopilotClientDeps = {
  fetchImpl?: typeof fetch;
  fetchKlines?: FetchKlines;
  getClosedTimes?: () => Set<number> | undefined;
  getCoordApi?: () => import("./chart-api").ChartCoordinateApi | null;
  baseUrl?: string;
};

export type CopilotClient = {
  analyze: (prompt: string) => Promise<void>;
  onClosedKline: () => void;
  pollHealth: () => Promise<void>;
  watchShapesReset: () => void;
  dispose: () => void;
};

function resolveBaseUrl(explicit?: string): string {
  if (explicit !== undefined) return explicit.replace(/\/$/, "");
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const fromEnv = env?.NEXT_PUBLIC_COPILOT_URL;
  // Unset or empty → same-origin (Next dev rewrite or local stack).
  if (fromEnv === undefined || fromEnv === null || fromEnv.trim() === "") {
    return DEFAULT_BASE;
  }
  return fromEnv.replace(/\/$/, "");
}

function mapHttpError(status: number): string {
  if (status === 401 || status === 403) return COPILOT_ERROR_UNAUTHORIZED;
  if (status === 402) return COPILOT_ERROR_CREDITS_EXHAUSTED;
  if (status === 429) return COPILOT_ERROR_RATE_LIMITED;
  return COPILOT_ERROR;
}

function closedCandlesFromChart(
  candles: Candle[],
  closedTimes: Set<number> | undefined,
): Candle[] {
  if (closedTimes) {
    return candles.filter((c) => closedTimes.has(c.time));
  }
  if (candles.length <= 1) return [];
  return candles.slice(0, -1);
}

function resolveClosedTimes(
  candles: Candle[],
  closedTimes: Set<number> | undefined,
): Set<number> {
  if (closedTimes) return closedTimes;
  return new Set(closedCandlesFromChart(candles, undefined).map((c) => c.time));
}

/** Keep shapes whose every point.time is in the allowed closed candle set. */
export function filterShapesToClosedTimes(
  shapes: PatternShape[],
  allowedTimes: Set<number>,
): { valid: PatternShape[]; droppedIds: string[] } {
  const valid: PatternShape[] = [];
  const droppedIds: string[] = [];
  for (const shape of shapes) {
    const ok = shape.points.every((p) => allowedTimes.has(p.time));
    if (ok) valid.push(shape);
    else droppedIds.push(shape.id);
  }
  return { valid, droppedIds };
}

/** Keep markers whose time is in the allowed closed candle set. */
export function filterMarkersToClosedTimes(
  markers: AgentMarker[],
  allowedTimes: Set<number>,
): { valid: AgentMarker[]; droppedIds: string[] } {
  const valid: AgentMarker[] = [];
  const droppedIds: string[] = [];
  for (const marker of markers) {
    if (allowedTimes.has(marker.time)) valid.push(marker);
    else droppedIds.push(marker.id);
  }
  return { valid, droppedIds };
}

function isSuperseded(data: Record<string, unknown>): boolean {
  return data.superseded === true || data.note === "superseded";
}

function parseSseBlocks(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    if (!part.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest };
}

function noteDroppedShapes(ids: string[]): void {
  if (ids.length === 0) return;
  useAiStore.getState().appendText(copilotSkippedShapes(ids.length));
}

function noteDroppedMarkers(ids: string[]): void {
  if (ids.length === 0) return;
  useAiStore.getState().appendText(copilotSkippedMarkers(ids.length));
}

export function createCopilotClient(deps: CopilotClientDeps = {}): CopilotClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchKlines = deps.fetchKlines ?? defaultFetchKlines;
  const baseUrl = resolveBaseUrl(deps.baseUrl);

  let queuedPrompt: string | null = null;
  let analyzing = false;
  let unsubReset: (() => void) | null = null;
  let lastResetSignal = useChartStore.getState().shapesResetSignal;

  const runQueuedIfAny = async () => {
    if (!queuedPrompt) return;
    const next = queuedPrompt;
    queuedPrompt = null;
    await analyze(next);
  };

  const handleEvent = async (event: string, raw: string): Promise<"ok" | "error" | "superseded"> => {
    let data: Record<string, unknown> = {};
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }

    type SseEvent = "text" | "shapes" | "markers" | "extendRange" | "error" | "done";
    const isSseEvent = (value: string): value is SseEvent =>
      value === "text" ||
      value === "shapes" ||
      value === "markers" ||
      value === "extendRange" ||
      value === "error" ||
      value === "done";

    if (!isSseEvent(event)) return "ok";

    switch (event) {
      case "text": {
        const delta = typeof data.delta === "string" ? data.delta : "";
        if (delta) useAiStore.getState().appendText(delta);
        return "ok";
      }
      case "shapes": {
        const list = Array.isArray(data.shapes) ? data.shapes : [];
        const zodValid: PatternShape[] = [];
        const droppedIds: string[] = [];
        const chart = useChartStore.getState();
        for (const item of list) {
          const coerced = coerceAgentShape(item, {
            symbol: chart.symbol,
            interval: chart.interval,
          });
          const parsed = PatternShapeSchema.safeParse(coerced);
          if (parsed.success) {
            zodValid.push(parsed.data);
          } else {
            const id =
              item && typeof item === "object" && "id" in item
                ? String((item as { id: unknown }).id)
                : typeof coerced === "object" && coerced && "id" in coerced
                  ? String((coerced as { id: unknown }).id)
                  : "unknown";
            droppedIds.push(id);
          }
        }
        const allowedTimes = resolveClosedTimes(chart.candles, deps.getClosedTimes?.());
        const { valid, droppedIds: outOfWindow } = filterShapesToClosedTimes(
          zodValid,
          allowedTimes,
        );
        droppedIds.push(...outOfWindow);
        useShapeStore.getState().setPreview(valid);
        if (valid.length > 0) {
          useShapeStore.getState().commitPreview();
          const lines = valid.map((s) =>
            copilotShapeSummaryLine(
              s.name,
              s.kind,
              Math.round(s.confidence * 100),
              s.points.length,
            ),
          );
          useAiStore.getState().appendText(copilotDrewShapes(valid.length, lines));
          const times = valid.flatMap((s) => s.points.map((pt) => pt.time));
          const visible = deps.getCoordApi?.()?.getVisibleTimeRange?.() ?? null;
          if (!timesInsideVisibleRange(times, visible)) {
            deps.getCoordApi?.()?.revealTimes(times);
            useAiStore.getState().appendText(COPILOT_SCROLLED_TO_OVERLAYS);
          }
        }
        noteDroppedShapes(droppedIds);
        return "ok";
      }
      case "markers": {
        const list = Array.isArray(data.markers) ? data.markers : [];
        const zodValid: AgentMarker[] = [];
        const droppedIds: string[] = [];
        const chart = useChartStore.getState();
        for (const item of list) {
          const coerced = coerceAgentMarker(item, {
            symbol: chart.symbol,
            interval: chart.interval,
          });
          const parsed = AgentMarkerSchema.safeParse(coerced);
          if (parsed.success) {
            zodValid.push(parsed.data);
          } else {
            const id =
              item && typeof item === "object" && "id" in item
                ? String((item as { id: unknown }).id)
                : "unknown";
            droppedIds.push(id);
          }
        }
        const allowedTimes = resolveClosedTimes(chart.candles, deps.getClosedTimes?.());
        const { valid, droppedIds: outOfWindow } = filterMarkersToClosedTimes(
          zodValid,
          allowedTimes,
        );
        droppedIds.push(...outOfWindow);
        useMarkerStore.getState().setMarkers(valid);
        if (valid.length > 0) {
          useAiStore.getState().appendText(copilotPlacedMarkers(valid.length));
        }
        noteDroppedMarkers(droppedIds);
        return "ok";
      }
      case "extendRange": {
        const fromSec = typeof data.from === "number" ? data.from : null;
        const toSec = typeof data.to === "number" ? data.to : null;
        const chart = useChartStore.getState();
        const range =
          fromSec != null && toSec != null
            ? { startTimeMs: fromSec * 1000, endTimeMs: toSec * 1000 }
            : undefined;
        const snapshot = await fetchKlines(chart.symbol, chart.interval, 1000, range);
        useChartStore.getState().setCandles(mergeCandles(chart.candles, snapshot.candles));
        return "ok";
      }
      case "error": {
        const message =
          typeof data.message === "string" && data.message.trim()
            ? mapCopilotSseError(data.message)
            : COPILOT_ERROR;
        useAiStore.getState().fail(message);
        return "error";
      }
      case "done": {
        if (isSuperseded(data)) {
          useAiStore.getState().finish();
          return "superseded";
        }
        useAiStore.getState().finish();
        return "ok";
      }
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
        return "ok";
      }
    }
  };

  async function consumeSse(response: Response): Promise<void> {
    if (!response.body) {
      useAiStore.getState().fail(COPILOT_ERROR);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawError = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBlocks(buffer);
      buffer = parsed.rest;
      for (const ev of parsed.events) {
        const result = await handleEvent(ev.event, ev.data);
        if (result === "error") sawError = true;
      }
    }

    if (buffer.trim()) {
      const parsed = parseSseBlocks(buffer + "\n\n");
      for (const ev of parsed.events) {
        const result = await handleEvent(ev.event, ev.data);
        if (result === "error") sawError = true;
      }
    }

    if (useAiStore.getState().inFlight) {
      if (sawError) useAiStore.getState().fail(useAiStore.getState().lastError ?? COPILOT_ERROR);
      else useAiStore.getState().finish();
    }
  }

  async function analyze(prompt: string): Promise<void> {
    if (analyzing || useAiStore.getState().inFlight) {
      queuedPrompt = prompt;
      return;
    }

    const chart = useChartStore.getState();
    const closedTimes = deps.getClosedTimes?.();
    const allClosed = closedCandlesFromChart(chart.candles, closedTimes);
    if (allClosed.length === 0) return;

    const visibleRange = deps.getCoordApi?.()?.getVisibleTimeRange?.() ?? null;
    const window = selectAnalysisCandles(allClosed, { visibleRange, prompt });
    if (window.candles.length === 0) return;

    analyzing = true;
    useAiStore.getState().appendUser(prompt);
    useAiStore.getState().startAgent();

    const annotatedPrompt = annotatePromptWithWindow(prompt, window);
    const body = {
      symbol: chart.symbol,
      interval: chart.interval,
      from: window.from,
      to: window.to,
      closedCandles: window.candles,
      existingShapes: useShapeStore.getState().committed(),
      existingMarkers: useMarkerStore.getState().markers,
      prompt: annotatedPrompt,
    };

    try {
      const res = await fetchImpl(`${baseUrl}/v1/copilot/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        useAiStore.getState().fail(mapHttpError(res.status));
        return;
      }

      await consumeSse(res);
    } catch {
      useAiStore.getState().fail(COPILOT_ERROR);
    } finally {
      analyzing = false;
      if (useAiStore.getState().inFlight) {
        useAiStore.getState().finish();
      }
      await runQueuedIfAny();
    }
  }

  return {
    analyze,
    onClosedKline: () => {
      if (useAiStore.getState().mode !== "auto") return;
      if (analyzing || useAiStore.getState().inFlight) {
        queuedPrompt = AUTO_DRAW_PROMPT;
        return;
      }
      void analyze(AUTO_DRAW_PROMPT);
    },
    pollHealth: async () => {
      try {
        const res = await fetchImpl(`${baseUrl}/v1/copilot/health`);
        if (!res.ok) {
          useAiStore.getState().setHealth(null);
          return;
        }
        const json = (await res.json()) as {
          ok?: boolean;
          style?: string;
          model?: string;
          baseHost?: string;
        };
        useAiStore.getState().setHealth({
          ok: Boolean(json.ok),
          style: String(json.style ?? ""),
          model: String(json.model ?? ""),
          baseHost: String(json.baseHost ?? ""),
        });
      } catch {
        useAiStore.getState().setHealth(null);
      }
    },
    watchShapesReset: () => {
      if (unsubReset) return;
      lastResetSignal = useChartStore.getState().shapesResetSignal;
      unsubReset = useChartStore.subscribe((state) => {
        if (state.shapesResetSignal !== lastResetSignal) {
          lastResetSignal = state.shapesResetSignal;
          useShapeStore.getState().clearAll();
          useMarkerStore.getState().clearAll();
        }
      });
    },
    dispose: () => {
      unsubReset?.();
      unsubReset = null;
    },
  };
}
