import { mergeCandles } from "./binance";
import { mapCopilotHttpError, mapCopilotSseErrorPayload } from "./copilot-errors";
import { displayShapeName } from "./copilot-display";
import {
  formatSkippedBreakdown,
  isAnalysisSseEmpty,
  parseAnalysisSseEvent,
  parseSkippedFromPayload,
} from "./copilot-chart-ai";
import {
  AnalyzeMetaEventSchema,
  RegimeSseEventSchema,
  type AnalyzeMetaEvent,
} from "./copilot-schema";
import { mergeAnalyzeMeta } from "./sse-analyze-meta";
import { isServerOverlayReadyText, joinStreamTextBlocks } from "./sse-stream-text";
import { modelIdForAnalyzeRequest, modelLabelForSession } from "./copilot-model-defaults";
import {
  findCachedModel,
  getCachedModelsResponse,
  getDefaultModelId,
  getModelsList,
} from "./copilot-models-cache";
import { probeStatusLabel, unhealthyModelFromError } from "./copilot-model-probe";
import { reasoningEffortForAnalyze } from "./copilot-reasoning";
import { resolveCopilotBaseUrl, type ApiErrorBody } from "./copilot-api";
import {
  AUTO_DRAW_PROMPT,
  COPILOT_ERROR,
  copilotDrewShapes,
  copilotPlacedMarkers,
  copilotShapeSummaryLine,
  copilotSkippedMarkers,
  copilotSkippedShapes,
  COPILOT_SCROLLED_TO_OVERLAYS,
  COPILOT_SERVER_PICKED_SHAPES,
  copilotUnhealthyModelError,
} from "./copilot-strings";
import { useCopilotSessionStore } from "./stores/copilot-session-store";
import { fetchKlines as defaultFetchKlines, type FetchKlines } from "./market-client";
import { filterRenderableAnchorMarkers } from "./marker-map";
import { coerceAgentMarker, coerceAgentShape } from "./normalize-agent-shape";
import {
  AgentMarkerSchema,
  PatternShapeSchema,
  type AgentMarker,
  type Candle,
  type Interval,
  type PatternShape,
} from "./pattern-shape";
import {
  annotatePromptWithWindow,
  selectAnalysisCandles,
  timesInsideVisibleRange,
} from "./analysis-window";
import { filterShapesWithProjection } from "./shape-projection";
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

async function readHttpErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

/** Maps an analyze HTTP error; an unhealthy-model 4xx also triggers a models refresh + auto-switch. */
async function handleAnalyzeHttpError(res: Response): Promise<string> {
  const body = await readHttpErrorBody(res);
  const unhealthy = unhealthyModelFromError(res.status, body);
  if (!unhealthy) return mapCopilotHttpError(res.status, body);
  void useCopilotSessionStore.getState().handleUnhealthyModel();
  return copilotUnhealthyModelError(
    unhealthy.status ? probeStatusLabel(unhealthy.status) : undefined,
  );
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

/** Closed-candle times plus one forward agent endpoint on the projection grid (see shape-projection). */
export function filterShapesToClosedTimes(
  shapes: PatternShape[],
  allowedTimes: Set<number>,
  closedCandles: Candle[],
  interval: Interval,
): { valid: PatternShape[]; droppedIds: string[] } {
  return filterShapesWithProjection(shapes, allowedTimes, closedCandles, interval);
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

function shapeIdsOnChart(): Set<string> {
  return new Set(useShapeStore.getState().shapes.map((shape) => shape.id));
}

function applyRenderableStreamMarkers(
  timeValidMarkers: AgentMarker[],
): { renderable: AgentMarker[]; renderableCount: number } {
  const renderable = filterRenderableAnchorMarkers(timeValidMarkers, shapeIdsOnChart());
  useMarkerStore.getState().setMarkers(renderable);
  return { renderable, renderableCount: renderable.length };
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

function appendAgentChatLine(delta: string): void {
  if (!delta) return;
  const messages = useAiStore.getState().messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "agent") {
      messages[i] = {
        ...msg,
        content: joinStreamTextBlocks(msg.content, delta),
      };
      useAiStore.setState({ messages });
      return;
    }
  }
}

function noteDroppedShapes(ids: string[]): void {
  if (ids.length === 0) return;
  appendAgentChatLine(copilotSkippedShapes(ids.length));
}

function appendServerSkippedNote(data: Record<string, unknown>): void {
  const text = formatSkippedBreakdown(parseSkippedFromPayload(data));
  if (text) appendAgentChatLine(text);
}

function appendAgentStreamText(delta: string): void {
  appendAgentChatLine(delta);
}

function appendMetaFallbackNote(meta: AnalyzeMetaEvent): void {
  if (!meta.validator_fallback && !meta.intent_budget_fallback) return;
  appendAgentChatLine(COPILOT_SERVER_PICKED_SHAPES);
}

function patchLastAgentMessageFromMeta(meta: AnalyzeMetaEvent): void {
  const messages = useAiStore.getState().messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "agent") {
      messages[i] = {
        ...msg,
        modelId: meta.model,
        modelLabel: modelLabelForSession(getModelsList(), meta.model, getDefaultModelId()),
        analyzeMeta: {
          candle_count_used: meta.candle_count_used,
          clamped: meta.clamped,
          intent_check: meta.intent_check,
        },
      };
      useAiStore.setState({ messages });
      break;
    }
  }
}

function noteDroppedMarkers(ids: string[]): void {
  if (ids.length === 0) return;
  appendAgentChatLine(copilotSkippedMarkers(ids.length));
}

export function createCopilotClient(deps: CopilotClientDeps = {}): CopilotClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchKlines = deps.fetchKlines ?? defaultFetchKlines;
  const baseUrl = resolveCopilotBaseUrl(deps.baseUrl);

  let queuedPrompt: string | null = null;
  let analyzing = false;
  let unsubReset: (() => void) | null = null;
  let lastResetSignal = useChartStore.getState().shapesResetSignal;
  let streamMergedMeta: AnalyzeMetaEvent | null = null;
  let streamNotesFinalized = false;
  let streamSawServerOverlayText = false;
  let pendingDrewShapesNotice: { count: number; lines: string[] } | null = null;
  let streamTimeValidMarkers: AgentMarker[] = [];
  let streamRenderableAnchorCount = 0;

  const applyStreamMergedMeta = (merged: AnalyzeMetaEvent): void => {
    streamMergedMeta = merged;
    useCopilotSessionStore.getState().setLastAnalyzeMeta(merged);
    patchLastAgentMessageFromMeta(merged);
  };

  const mergeIntentCheckIntoStreamMeta = (
    intentCheck: AnalyzeMetaEvent["intent_check"],
  ): void => {
    if (!intentCheck) return;
    const prev = streamMergedMeta ?? useCopilotSessionStore.getState().lastAnalyzeMeta;
    if (!prev) return;
    applyStreamMergedMeta(mergeAnalyzeMeta(prev, { ...prev, intent_check: intentCheck }));
  };

  const flushPendingDrewShapesNotice = (): void => {
    if (streamSawServerOverlayText || !pendingDrewShapesNotice) return;
    const { count, lines } = pendingDrewShapesNotice;
    if (count <= 0 || lines.length === 0) {
      pendingDrewShapesNotice = null;
      return;
    }
    pendingDrewShapesNotice = null;
    appendAgentChatLine(copilotDrewShapes(count, lines));
  };

  const finalizeStreamAnalyzeNotes = (): void => {
    if (streamNotesFinalized) return;
    streamNotesFinalized = true;
    flushPendingDrewShapesNotice();
    const anchorNote = copilotPlacedMarkers(streamRenderableAnchorCount);
    if (anchorNote) appendAgentChatLine(anchorNote);
    if (!streamMergedMeta) return;
    appendMetaFallbackNote(streamMergedMeta);
  };

  const resetStreamMetaAccumulator = (): void => {
    streamMergedMeta = null;
    streamNotesFinalized = false;
    streamSawServerOverlayText = false;
    pendingDrewShapesNotice = null;
    streamTimeValidMarkers = [];
    streamRenderableAnchorCount = 0;
  };

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

    type SseEvent =
      | "meta"
      | "regime"
      | "analysis"
      | "text"
      | "shapes"
      | "markers"
      | "extendRange"
      | "skipped"
      | "error"
      | "done";
    const isSseEvent = (value: string): value is SseEvent =>
      value === "meta" ||
      value === "regime" ||
      value === "analysis" ||
      value === "text" ||
      value === "shapes" ||
      value === "markers" ||
      value === "extendRange" ||
      value === "skipped" ||
      value === "error" ||
      value === "done";

    if (!isSseEvent(event)) return "ok";

    switch (event) {
      case "meta": {
        const parsed = AnalyzeMetaEventSchema.safeParse(data);
        if (parsed.success) {
          const merged = mergeAnalyzeMeta(streamMergedMeta, parsed.data);
          applyStreamMergedMeta(merged);
          appendServerSkippedNote(parsed.data);
        }
        return "ok";
      }
      case "regime": {
        const parsed = RegimeSseEventSchema.safeParse(data);
        if (parsed.success) {
          useCopilotSessionStore.getState().setLastDetectedRegime(parsed.data.regime);
          if (parsed.data.intent_check) {
            useCopilotSessionStore.getState().setStreamingIntentCheck(parsed.data.intent_check);
            mergeIntentCheckIntoStreamMeta(parsed.data.intent_check);
          }
        }
        return "ok";
      }
      case "analysis": {
        const analysis = parseAnalysisSseEvent(data);
        if (analysis && !isAnalysisSseEmpty(analysis)) {
          useCopilotSessionStore.getState().setLastAnalysisEvent(analysis);
          if (analysis.intent_check) {
            useCopilotSessionStore.getState().setStreamingIntentCheck(analysis.intent_check);
            mergeIntentCheckIntoStreamMeta(analysis.intent_check);
          }
        }
        return "ok";
      }
      case "skipped": {
        appendServerSkippedNote(data);
        return "ok";
      }
      case "text": {
        const delta = typeof data.delta === "string" ? data.delta : "";
        if (delta) {
          if (isServerOverlayReadyText(delta)) streamSawServerOverlayText = true;
          appendAgentStreamText(delta);
        }
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
        const closedSlice = closedCandlesFromChart(chart.candles, deps.getClosedTimes?.());
        const allowedTimes = resolveClosedTimes(chart.candles, deps.getClosedTimes?.());
        const { valid, droppedIds: outOfWindow } = filterShapesToClosedTimes(
          zodValid,
          allowedTimes,
          closedSlice,
          chart.interval,
        );
        droppedIds.push(...outOfWindow);
        useShapeStore.getState().setPreview(valid);
        if (valid.length > 0) {
          useShapeStore.getState().commitPreview();
          const lines = valid.map((s) =>
            copilotShapeSummaryLine(
              displayShapeName(s.name),
              s.kind,
              Math.round(s.confidence * 100),
              s.points.length,
            ),
          );
          pendingDrewShapesNotice = { count: valid.length, lines };
          const times = valid.flatMap((s) => s.points.map((pt) => pt.time));
          const visible = deps.getCoordApi?.()?.getVisibleTimeRange?.() ?? null;
          if (!timesInsideVisibleRange(times, visible)) {
            deps.getCoordApi?.()?.revealTimes(times);
            appendAgentChatLine(COPILOT_SCROLLED_TO_OVERLAYS.trim());
          }
        }
        noteDroppedShapes(droppedIds);
        appendServerSkippedNote(data);
        if (streamTimeValidMarkers.length > 0) {
          streamRenderableAnchorCount = applyRenderableStreamMarkers(streamTimeValidMarkers).renderableCount;
        }
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
        streamTimeValidMarkers = valid;
        streamRenderableAnchorCount = applyRenderableStreamMarkers(valid).renderableCount;
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
        useAiStore.getState().fail(mapCopilotSseErrorPayload(data));
        useCopilotSessionStore.getState().persistActiveSession();
        return "error";
      }
      case "done": {
        finalizeStreamAnalyzeNotes();
        resetStreamMetaAccumulator();
        if (isSuperseded(data)) {
          useAiStore.getState().finish();
          useCopilotSessionStore.getState().persistActiveSession();
          return "superseded";
        }
        useAiStore.getState().finish();
        useCopilotSessionStore.getState().persistActiveSession();
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
      else {
        finalizeStreamAnalyzeNotes();
        useAiStore.getState().finish();
      }
      resetStreamMetaAccumulator();
    }
  }

  async function analyze(prompt: string): Promise<void> {
    if (analyzing || useAiStore.getState().inFlight) {
      queuedPrompt = prompt;
      return;
    }

    // Probe says no model can serve: never send (covers auto-draw on closed klines too).
    if (getCachedModelsResponse()?.models.length === 0) return;

    const chart = useChartStore.getState();
    const closedTimes = deps.getClosedTimes?.();
    const allClosed = closedCandlesFromChart(chart.candles, closedTimes);
    if (allClosed.length === 0) return;

    const sessionState = useCopilotSessionStore.getState();
    const candleCount = sessionState.getRequestedCandleCount(allClosed.length);
    const visibleRange = deps.getCoordApi?.()?.getVisibleTimeRange?.() ?? null;
    const window = selectAnalysisCandles(allClosed, {
      visibleRange,
      prompt,
      candleCount,
    });
    if (window.candles.length === 0) return;

    const models = getModelsList();
    const apiDefault = getDefaultModelId();
    const analyzeModelId = modelIdForAnalyzeRequest(
      models,
      sessionState.modelId,
      apiDefault,
    );
    const displayModelId =
      analyzeModelId ?? sessionState.modelId ?? apiDefault ?? undefined;
    const model = findCachedModel(analyzeModelId ?? sessionState.modelId);

    analyzing = true;
    resetStreamMetaAccumulator();
    useCopilotSessionStore.getState().clearAnalyzeStreamState();
    useAiStore.getState().appendUser(prompt);
    useAiStore.getState().startAgent({
      modelId: model?.id ?? displayModelId,
      modelLabel: modelLabelForSession(
        models,
        model?.id ?? displayModelId,
        apiDefault,
      ),
    });
    useCopilotSessionStore.getState().recordAnalysisWindow(window.from, window.to);

    const annotatedPrompt = annotatePromptWithWindow(prompt, window);
    const body: Record<string, unknown> = {
      symbol: chart.symbol,
      interval: chart.interval,
      from: window.from,
      to: window.to,
      closedCandles: window.candles,
      existingShapes: useShapeStore.getState().committed(),
      existingMarkers: useMarkerStore.getState().markers,
      prompt: annotatedPrompt,
      candle_count: candleCount,
    };
    if (analyzeModelId) {
      body.model = analyzeModelId;
    }
    const reasoningEffort = reasoningEffortForAnalyze(model, sessionState.reasoningEffort);
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }
    if (sessionState.activeSessionId) {
      body.session_id = sessionState.activeSessionId;
    }

    try {
      const res = await fetchImpl(`${baseUrl}/v1/copilot/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        useAiStore.getState().fail(await handleAnalyzeHttpError(res));
        useCopilotSessionStore.getState().persistActiveSession();
        return;
      }

      await consumeSse(res);
    } catch {
      useAiStore.getState().fail(COPILOT_ERROR);
      useCopilotSessionStore.getState().persistActiveSession();
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
