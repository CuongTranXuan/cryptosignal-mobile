import { create } from "zustand";
import type { CopilotApiClient } from "../copilot-api";
import { DEFAULT_CANDLE_COUNT, clampCandleCountForModel } from "../copilot-model-limits";
import {
  modelIdForAnalyzeRequest,
  resolveDefaultModelId,
  resolveSessionModelId,
} from "../copilot-model-defaults";
import { syncModelsSnapshotFromCache } from "../../components/copilot/use-copilot-models";
import {
  defaultReasoningEffortForModel,
  resetReasoningForModel,
} from "../copilot-reasoning";
import {
  findCachedModel,
  getCachedModelsResponse,
  getDefaultModelId,
  getModelsList,
  loadCopilotModels,
} from "../copilot-models-cache";
import { COPILOT_CANDLE_CLAMPED_TO_MAX } from "../copilot-strings";
import type { AnalyzeMetaEvent, CopilotSessionV1 } from "../copilot-schema";
import {
  createEmptySession,
  loadSessionsBlob,
  saveSessionsBlob,
  sessionSummary,
  shapesFromSessionMessages,
  markersFromSessionMessages,
} from "../copilot-sessions-v1";
import type { AiMessage } from "./ai-store";
import { useAiStore } from "./ai-store";
import { useChartStore } from "./chart-store";
import { useMarkerStore } from "./marker-store";
import { useShapeStore } from "./shape-store";
import type { AgentMarker, PatternShape } from "../pattern-shape";

function aiToSessionMessages(messages: AiMessage[]): CopilotSessionV1["messages"] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
    model_id: m.modelId ?? null,
    shapes: (m.shapes ?? []) as PatternShape[],
    markers: m.markers,
    created_at: m.createdAt ?? Math.floor(Date.now() / 1000),
    meta: m.analyzeMeta
      ? { candle_count_used: m.analyzeMeta.candle_count_used, clamped: m.analyzeMeta.clamped }
      : undefined,
  }));
}

function sessionToAiMessages(messages: CopilotSessionV1["messages"]): AiMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role === "user" ? "user" : "agent",
    content: m.content,
    modelId: m.model_id ?? undefined,
    modelLabel: m.model_id ?? undefined,
    shapes: m.shapes as PatternShape[],
    markers: m.markers as AgentMarker[] | undefined,
    createdAt: m.created_at,
    analyzeMeta: m.meta,
  }));
}

type CopilotSessionState = {
  api: CopilotApiClient | null;
  sessions: ReturnType<typeof sessionSummary>[];
  activeSessionId: string | null;
  modelId: string | null;
  candleCount: number;
  customCandleCount: number | null;
  candleClampHint: string | null;
  lastAnalyzeMeta: AnalyzeMetaEvent | null;
  chartFrom: number;
  chartTo: number;
  reasoningEffort: string | null;
  modelsReady: boolean;
  setApi: (api: CopilotApiClient) => void;
  bootstrap: () => Promise<void>;
  setModelId: (modelId: string) => void;
  setReasoningEffort: (apiEffort: string | null) => void;
  setCandleCountPreset: (count: number) => void;
  setCustomCandleCount: (count: number) => void;
  getRequestedCandleCount: (closedAvailable?: number) => number;
  setLastAnalyzeMeta: (meta: AnalyzeMetaEvent | null) => void;
  createSession: () => void;
  switchSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  persistActiveSession: () => void;
  recordAnalysisWindow: (from: number, to: number) => void;
};

function getActiveSession(blob: ReturnType<typeof loadSessionsBlob>): CopilotSessionV1 | null {
  if (!blob.active_session_id) return null;
  return blob.sessions.find((s) => s.id === blob.active_session_id) ?? null;
}

function applySessionToUi(session: CopilotSessionV1): void {
  useChartStore.setState({
    symbol: session.chart.symbol,
    interval: session.chart.interval as import("../pattern-shape").Interval,
  });
  useShapeStore.setState({
    shapes: shapesFromSessionMessages(session),
    selectedId: null,
  });
  useMarkerStore.setState({ markers: markersFromSessionMessages(session) });
  useAiStore.setState({
    messages: sessionToAiMessages(session.messages),
    lastError: null,
    inFlight: false,
  });
}

export const useCopilotSessionStore = create<CopilotSessionState>((set, get) => ({
  api: null,
  sessions: [],
  activeSessionId: null,
  modelId: null,
  candleCount: DEFAULT_CANDLE_COUNT,
  customCandleCount: null,
  candleClampHint: null,
  lastAnalyzeMeta: null,
  chartFrom: 0,
  chartTo: 0,
  reasoningEffort: null,
  modelsReady: false,

  setApi: (api) => set({ api }),

  bootstrap: async () => {
    const api = get().api;
    if (!api) return;
    let models = getModelsList();
    try {
      const response = await loadCopilotModels(api);
      models = response.models;
      syncModelsSnapshotFromCache();
      set({ modelsReady: true });
    } catch {
      syncModelsSnapshotFromCache();
      set({ modelsReady: true });
    }

    const blob = loadSessionsBlob();
    let sessions = blob.sessions;
    let active = getActiveSession(blob);
    const apiDefault = getCachedModelsResponse()?.default_model ?? getDefaultModelId();
    if (sessions.length === 0) {
      const model = resolveSessionModelId(models, null, apiDefault);
      const effort = defaultReasoningEffortForModel(findCachedModel(model));
      active = createEmptySession(model, "Phiên mới", effort);
      sessions = [active];
      saveSessionsBlob({ active_session_id: active.id, sessions });
    } else if (!active) {
      active = sessions[0]!;
      saveSessionsBlob({ active_session_id: active.id, sessions });
    }

    const resolvedModelId = resolveSessionModelId(models, active.model_id, apiDefault);
    const resolvedModel = findCachedModel(resolvedModelId);
    const reasoningEffort = resetReasoningForModel(
      resolvedModel,
      active.reasoning_effort ?? null,
    );
    if (resolvedModelId !== active.model_id || reasoningEffort !== active.reasoning_effort) {
      active = {
        ...active,
        model_id: resolvedModelId,
        reasoning_effort: reasoningEffort,
      };
      sessions = sessions.map((s) => (s.id === active!.id ? active! : s));
      saveSessionsBlob({ active_session_id: active.id, sessions });
    }

    set({
      sessions: sessions.map(sessionSummary),
      activeSessionId: active.id,
      modelId: resolvedModelId,
      candleCount: active.chart.candle_count || DEFAULT_CANDLE_COUNT,
      chartFrom: active.chart.from,
      chartTo: active.chart.to,
      reasoningEffort,
    });
    applySessionToUi(active);
  },

  setModelId: (modelId) => {
    const model = findCachedModel(modelId);
    const reasoningEffort = resetReasoningForModel(model, get().reasoningEffort);
    set({ modelId, reasoningEffort });
    get().persistActiveSession();
  },

  setReasoningEffort: (apiEffort) => {
    set({ reasoningEffort: apiEffort });
    get().persistActiveSession();
  },

  setCandleCountPreset: (count) => {
    set({ candleCount: count, customCandleCount: null, candleClampHint: null });
    get().persistActiveSession();
  },

  setCustomCandleCount: (count) => {
    const model = findCachedModel(get().modelId);
    const requested = Math.floor(count);
    const clamped = clampCandleCountForModel(count, model);
    const hint =
      Number.isFinite(requested) && requested > clamped
        ? COPILOT_CANDLE_CLAMPED_TO_MAX.replace("{max}", String(clamped))
        : null;
    set({ candleCount: clamped, customCandleCount: clamped, candleClampHint: hint });
    get().persistActiveSession();
  },

  getRequestedCandleCount: (closedAvailable) => {
    const model = findCachedModel(get().modelId);
    return clampCandleCountForModel(get().candleCount, model, closedAvailable);
  },

  setLastAnalyzeMeta: (meta) => {
    // Last SSE `meta` wins (server may emit again on retry with fewer candles).
    set({
      lastAnalyzeMeta: meta,
      ...(meta?.candle_count_used != null ? { candleCount: meta.candle_count_used } : {}),
    });
    get().persistActiveSession();
  },

  createSession: () => {
    const models = getModelsList();
    const modelId = resolveSessionModelId(models, get().modelId, getDefaultModelId());
    const session = createEmptySession(modelId, "Phiên mới", get().reasoningEffort);
    session.chart.candle_count = get().getRequestedCandleCount();
    const blob = loadSessionsBlob();
    const sessions = [session, ...blob.sessions];
    saveSessionsBlob({ active_session_id: session.id, sessions });
    set({
      sessions: sessions.map(sessionSummary),
      activeSessionId: session.id,
      lastAnalyzeMeta: null,
    });
    useAiStore.setState({ messages: [], lastError: null, inFlight: false });
    applySessionToUi(session);
  },

  switchSession: (id) => {
    get().persistActiveSession();
    const blob = loadSessionsBlob();
    const session = blob.sessions.find((s) => s.id === id);
    if (!session) return;
    saveSessionsBlob({ active_session_id: id, sessions: blob.sessions });
    const models = getModelsList();
    const apiDefault = getDefaultModelId();
    const resolvedId = resolveSessionModelId(models, session.model_id, apiDefault);
    const model = findCachedModel(resolvedId);
    set({
      activeSessionId: id,
      modelId: resolvedId,
      candleCount: session.chart.candle_count,
      customCandleCount: null,
      lastAnalyzeMeta: null,
      reasoningEffort: resetReasoningForModel(model, session.reasoning_effort ?? null),
      sessions: blob.sessions.map(sessionSummary),
    });
    applySessionToUi(session);
  },

  renameSession: (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const blob = loadSessionsBlob();
    const sessions = blob.sessions.map((s) =>
      s.id === id ? { ...s, title: trimmed, updated_at: Math.floor(Date.now() / 1000) } : s,
    );
    saveSessionsBlob({ active_session_id: blob.active_session_id, sessions });
    set({ sessions: sessions.map(sessionSummary) });
  },

  deleteSession: (id) => {
    const blob = loadSessionsBlob();
    const sessions = blob.sessions.filter((s) => s.id !== id);
    if (blob.active_session_id === id) {
      if (sessions.length === 0) {
        const models = getModelsList();
        const modelId = resolveSessionModelId(models, get().modelId, getDefaultModelId());
        const fresh = createEmptySession(modelId, "Phiên mới", get().reasoningEffort);
        sessions.push(fresh);
        saveSessionsBlob({ active_session_id: fresh.id, sessions });
        set({
          sessions: sessions.map(sessionSummary),
          activeSessionId: fresh.id,
          lastAnalyzeMeta: null,
        });
        applySessionToUi(fresh);
        return;
      }
      const next = sessions[0]!;
      saveSessionsBlob({ active_session_id: next.id, sessions });
      set({
        sessions: sessions.map(sessionSummary),
        activeSessionId: next.id,
        modelId: next.model_id,
        candleCount: next.chart.candle_count,
        lastAnalyzeMeta: null,
      });
      applySessionToUi(next);
      return;
    }
    saveSessionsBlob({ active_session_id: blob.active_session_id, sessions });
    set({ sessions: sessions.map(sessionSummary) });
  },

  persistActiveSession: () => {
    const { activeSessionId, modelId, candleCount, reasoningEffort } = get();
    if (!activeSessionId) return;
    const blob = loadSessionsBlob();
    const shapes = useShapeStore.getState().shapes;
    const markers = useMarkerStore.getState().markers;
    const chartStore = useChartStore.getState();
    const messages = aiToSessionMessages(useAiStore.getState().messages);
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx >= 0) {
      messages[lastAssistantIdx] = {
        ...messages[lastAssistantIdx]!,
        shapes: shapes as PatternShape[],
        markers: markers as AgentMarker[],
      };
    }
    const { chartFrom, chartTo } = get();
    const sessions = blob.sessions.map((s) => {
      if (s.id !== activeSessionId) return s;
      return {
        ...s,
        updated_at: Math.floor(Date.now() / 1000),
        model_id: resolveSessionModelId(
          getModelsList(),
          modelId ?? s.model_id,
          getDefaultModelId(),
        ),
        reasoning_effort: reasoningEffort,
        chart: {
          symbol: chartStore.symbol,
          interval: chartStore.interval,
          from: chartFrom,
          to: chartTo,
          candle_count: candleCount,
        },
        messages,
      };
    });
    saveSessionsBlob({ active_session_id: activeSessionId, sessions });
    set({ sessions: sessions.map(sessionSummary) });
  },

  recordAnalysisWindow: (from, to) => {
    set({ chartFrom: from, chartTo: to });
    get().persistActiveSession();
  },
}));
