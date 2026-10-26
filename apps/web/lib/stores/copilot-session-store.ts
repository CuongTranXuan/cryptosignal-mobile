import { create } from "zustand";
import type { CopilotApiClient } from "../copilot-api";
import { loadActiveSessionId, saveActiveSessionId } from "../copilot-active-session-cache";
import { DEFAULT_CANDLE_COUNT, clampCandleCountForModel } from "../copilot-model-limits";
import { resolveCatalogDefaultId, resolveSessionModelId } from "../copilot-model-defaults";
import {
  getModelProbeReport,
  refreshCopilotModels,
  syncModelsSnapshotFromCache,
} from "../../components/copilot/use-copilot-models";
import {
  isProbeIncomplete,
  modelSwitchedFrom,
  probeReasonForModel,
  resolveModelDuringProbe,
} from "../copilot-model-probe";
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
import {
  COPILOT_CANDLE_CLAMPED_TO_MAX,
  COPILOT_SESSIONS_MIGRATION_PARTIAL,
  COPILOT_SESSIONS_OFFLINE,
  COPILOT_SESSIONS_SAVE_FAILED,
  copilotModelSwitchedNotice,
} from "../copilot-strings";
import { CopilotApiError } from "../copilot-api";
import { mapCopilotHttpError } from "../copilot-errors";
import { migrateLegacyChartIntentLocalStorage } from "../copilot-intent-migration";
import type {
  AnalysisSseEvent,
  AnalyzeIntent,
  AnalyzeMetaEvent,
  CopilotSessionV1,
  DrawingRegime,
  IntentCheck,
  SessionSummary,
} from "../copilot-schema";
import {
  agentMessageModelLabel,
  apiSessionToClient,
  clientSessionToCreateBody,
  clientSessionToUpdateBody,
  markersFromSessionMessages,
  shapesFromSessionMessages,
  summaryFromApi,
  summaryFromApiSession,
  summaryFromClientSession,
} from "../copilot-session-mapper";
import { repairLegacyEncodedSessionTitle } from "../copilot-session-legacy-cleanup";
import { migrateLegacySessionsIfNeeded } from "../copilot-session-migration";
import { buildEmptyClientSession } from "../copilot-session-factory";
import type { AiMessage } from "./ai-store";
import { useAiStore } from "./ai-store";
import { useChartStore } from "./chart-store";
import { activateChartSession, flushChartSave } from "../chart-history";
import { useMarkerStore } from "./marker-store";
import { useShapeStore } from "./shape-store";
import { translateServerText } from "../vi-evidence";
import { stripChartHistoryFlags, type AgentMarker, type PatternShape } from "../pattern-shape";

function aiToSessionMessages(messages: AiMessage[]): CopilotSessionV1["messages"] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
    model_id: m.modelId ?? null,
    shapes: ((m.shapes ?? []) as PatternShape[]).map(stripChartHistoryFlags),
    markers: m.markers ?? [],
    created_at: m.createdAt ?? Math.floor(Date.now() / 1000),
    meta: m.analyzeMeta
      ? { candle_count_used: m.analyzeMeta.candle_count_used, clamped: m.analyzeMeta.clamped }
      : undefined,
  }));
}

function sessionToAiMessages(
  messages: CopilotSessionV1["messages"],
  models: ReturnType<typeof getModelsList>,
  apiDefault: string | null,
): AiMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role === "user" ? "user" : "agent",
    content: m.role === "user" ? m.content : translateServerText(m.content),
    modelId: m.model_id ?? undefined,
    modelLabel: agentMessageModelLabel(models, m.model_id, apiDefault),
    shapes: m.shapes as PatternShape[],
    markers: m.markers as AgentMarker[] | undefined,
    createdAt: m.created_at,
    analyzeMeta: m.meta,
  }));
}

type SessionListRow = ReturnType<typeof summaryFromApi>;

/** Vietnamese notice when the saved model is not healthy and the session moved to `resolvedId`. */
function switchNotice(
  models: ReturnType<typeof getModelsList>,
  savedId: string | null | undefined,
  resolvedId: string | null | undefined,
): string | null {
  const from = modelSwitchedFrom(models, savedId, resolvedId);
  if (!from || !resolvedId) return null;
  const reason = probeReasonForModel(getModelProbeReport(), from);
  return copilotModelSwitchedNotice(from, resolvedId, reason);
}

function probeIncomplete(): boolean {
  return isProbeIncomplete(getCachedModelsResponse() ?? null, getModelProbeReport());
}

/** Healthy model for the session; keeps the saved one while the probe is still running. */
function resolveModel(
  models: ReturnType<typeof getModelsList>,
  savedId: string | null | undefined,
  apiDefault: string | null,
): string | null {
  return resolveModelDuringProbe(savedId, probeIncomplete(), () =>
    resolveSessionModelId(models, savedId, apiDefault),
  );
}

type CopilotSessionState = {
  api: CopilotApiClient | null;
  sessions: SessionListRow[];
  activeSessionId: string | null;
  modelId: string | null;
  candleCount: number;
  customCandleCount: number | null;
  candleClampHint: string | null;
  lastAnalyzeMeta: AnalyzeMetaEvent | null;
  lastDetectedRegime: DrawingRegime | null;
  streamingIntentCheck: IntentCheck | null;
  lastAnalysisEvent: AnalysisSseEvent | null;
  chartFrom: number;
  chartTo: number;
  reasoningEffort: string | null;
  modelsReady: boolean;
  sessionsError: string | null;
  /** Shown after an automatic switch away from an unhealthy model. */
  modelNotice: string | null;
  sessionsDirty: boolean;
  sessionCache: Record<string, CopilotSessionV1>;
  listFetchedAt: number;
  setApi: (api: CopilotApiClient) => void;
  bootstrap: () => Promise<void>;
  setModelId: (modelId: string) => void;
  dismissModelNotice: () => void;
  /** Move off the selected model when it is no longer in the healthy list. */
  reconcileModelWithCatalog: () => void;
  /** Analyze rejected the model as unhealthy: refetch models, then reconcile. */
  handleUnhealthyModel: () => Promise<void>;
  setReasoningEffort: (apiEffort: string | null) => void;
  setCandleCountPreset: (count: number) => void;
  setCustomCandleCount: (count: number) => void;
  getRequestedCandleCount: (closedAvailable?: number) => number;
  setLastAnalyzeMeta: (meta: AnalyzeMetaEvent | null) => void;
  clearAnalyzeStreamState: () => void;
  setLastDetectedRegime: (regime: DrawingRegime | null) => void;
  setStreamingIntentCheck: (check: IntentCheck | null) => void;
  setLastAnalysisEvent: (analysis: AnalysisSseEvent | null) => void;
  createSession: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  persistActiveSession: () => void;
  flushPersist: () => Promise<void>;
  recordAnalysisWindow: (from: number, to: number) => void;
  setSessionIntent: (intent: AnalyzeIntent | null) => Promise<void>;
};

function applySessionToUi(session: CopilotSessionV1): void {
  const models = getModelsList();
  const apiDefault = getDefaultModelId();
  // Save the chart we are leaving before the symbol/interval change.
  void flushChartSave();
  useChartStore.setState({
    symbol: session.chart.symbol,
    interval: session.chart.interval as import("../pattern-shape").Interval,
  });
  useShapeStore.setState({ selectedId: null });
  activateChartSession(session, {
    shapes: shapesFromSessionMessages(session),
    markers: markersFromSessionMessages(session),
  });
  useAiStore.setState({
    messages: sessionToAiMessages(session.messages, models, apiDefault),
    lastError: null,
    inFlight: false,
  });
}

function buildActiveSessionSnapshot(get: () => CopilotSessionState): CopilotSessionV1 | null {
  const { activeSessionId, modelId, candleCount, reasoningEffort, chartFrom, chartTo } = get();
  if (!activeSessionId) return null;
  const cached = get().sessionCache[activeSessionId];
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
      shapes: (shapes as PatternShape[]).map(stripChartHistoryFlags),
      markers: markers as AgentMarker[],
    };
  }
  const base = cached ?? buildEmptyClientSession(modelId ?? "", "Phiên mới", reasoningEffort);
  return {
    ...base,
    id: activeSessionId,
    updated_at: Math.floor(Date.now() / 1000),
    model_id:
      resolveModel(getModelsList(), modelId ?? base.model_id, getDefaultModelId()) ??
      base.model_id,
    reasoning_effort: reasoningEffort,
    intent: cached?.intent ?? base.intent ?? null,
    chart: {
      symbol: chartStore.symbol,
      interval: chartStore.interval,
      from: chartFrom,
      to: chartTo,
      candle_count: candleCount,
    },
    messages,
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight: Promise<void> | null = null;

export const useCopilotSessionStore = create<CopilotSessionState>((set, get) => ({
  api: null,
  sessions: [],
  activeSessionId: null,
  modelId: null,
  candleCount: DEFAULT_CANDLE_COUNT,
  customCandleCount: null,
  candleClampHint: null,
  lastAnalyzeMeta: null,
  lastDetectedRegime: null,
  streamingIntentCheck: null,
  lastAnalysisEvent: null,
  chartFrom: 0,
  chartTo: 0,
  reasoningEffort: null,
  modelsReady: false,
  sessionsError: null,
  modelNotice: null,
  sessionsDirty: false,
  sessionCache: {},
  listFetchedAt: 0,

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

    const apiDefault = getCachedModelsResponse()?.default_model ?? getDefaultModelId();

    let listError: string | null = null;
    let listRows = get().sessions;
    let serverSummaries: SessionSummary[] = [];
    try {
      const listed = await api.listSessions();
      serverSummaries = listed.sessions;
      listRows = serverSummaries.map(summaryFromApi);
      set({ sessions: listRows, listFetchedAt: Date.now(), sessionsError: null });
      try {
        await migrateLegacyChartIntentLocalStorage(api);
      } catch {
        // Non-fatal; legacy entries remain for a later bootstrap.
      }
    } catch {
      listError = COPILOT_SESSIONS_OFFLINE;
      set({ sessionsError: listError });
    }

    let migrationNote: string | null = null;
    if (!listError) {
      try {
        const migration = await migrateLegacySessionsIfNeeded(api, serverSummaries);
        if (migration.failures.length > 0) {
          migrationNote = COPILOT_SESSIONS_MIGRATION_PARTIAL;
        }
        if (migration.migratedActiveId) {
          saveActiveSessionId(migration.migratedActiveId);
        }
        const listed = await api.listSessions();
        serverSummaries = listed.sessions;
        listRows = serverSummaries.map(summaryFromApi);
        set({ sessions: listRows, listFetchedAt: Date.now() });
      } catch {
        migrationNote = COPILOT_SESSIONS_MIGRATION_PARTIAL;
      }
    }

    let activeId = loadActiveSessionId();
    if (!activeId || !listRows.some((s) => s.id === activeId)) {
      activeId = listRows[0]?.id ?? null;
    }

    let activeSession: CopilotSessionV1 | null = null;
    if (activeId && api) {
      try {
        const apiSession = await repairLegacyEncodedSessionTitle(
          api,
          await api.getSession(activeId),
        );
        activeSession = apiSessionToClient(apiSession);
        set({
          sessionCache: { ...get().sessionCache, [activeId]: activeSession },
        });
      } catch {
        listError = listError ?? COPILOT_SESSIONS_OFFLINE;
      }
    }

    if (!activeSession) {
      const model =
        resolveSessionModelId(models, null, apiDefault) ??
        resolveCatalogDefaultId(models, apiDefault);
      if (!model) {
        set({
          sessions: listRows,
          activeSessionId: null,
          modelId: null,
          sessionsError: listError,
          modelsReady: true,
        });
        return;
      }
      const effort = defaultReasoningEffortForModel(findCachedModel(model));
      const draft = buildEmptyClientSession(model, "Phiên mới", effort);
      try {
        const created = await api.createSession(clientSessionToCreateBody(draft));
        activeSession = apiSessionToClient(created);
        activeId = activeSession.id;
        listRows = [summaryFromApiSession(created), ...listRows.filter((s) => s.id !== created.id)];
        set({
          sessions: listRows,
          sessionCache: { ...get().sessionCache, [activeId]: activeSession },
          listFetchedAt: Date.now(),
        });
        saveActiveSessionId(activeId);
      } catch {
        set({
          sessionsError: COPILOT_SESSIONS_OFFLINE,
          sessionsDirty: true,
          sessionCache: { ...get().sessionCache, [draft.id]: draft },
          activeSessionId: draft.id,
          modelId: model,
          reasoningEffort: effort,
          candleCount: draft.chart.candle_count,
        });
        applySessionToUi(draft);
        return;
      }
    }

    const resolvedModelId = resolveModel(models, activeSession!.model_id, apiDefault);
    const resolvedModel = findCachedModel(resolvedModelId);
    const reasoningEffort = resetReasoningForModel(
      resolvedModel,
      activeSession!.reasoning_effort ?? null,
    );

    const notice = switchNotice(models, activeSession!.model_id, resolvedModelId);

    saveActiveSessionId(activeId);
    set({
      ...(notice ? { modelNotice: notice } : {}),
      sessions: listRows,
      activeSessionId: activeId,
      modelId: resolvedModelId,
      candleCount: activeSession!.chart.candle_count || DEFAULT_CANDLE_COUNT,
      chartFrom: activeSession!.chart.from,
      chartTo: activeSession!.chart.to,
      reasoningEffort,
      sessionsError: migrationNote ?? listError,
    });
    applySessionToUi({
      ...activeSession!,
      model_id: resolvedModelId ?? activeSession!.model_id,
      reasoning_effort: reasoningEffort,
    });
    if (notice) get().persistActiveSession();
  },

  flushPersist: async () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (persistInFlight) {
      await persistInFlight;
    }
    const api = get().api;
    const snapshot = buildActiveSessionSnapshot(get);
    if (!api || !snapshot?.id) return;

    const previous = get().sessionCache[snapshot.id];
    const run = async () => {
      try {
        const updated = await api.updateSession(snapshot.id, clientSessionToUpdateBody(snapshot));
        const client = apiSessionToClient(updated);
        set({
          sessionCache: { ...get().sessionCache, [snapshot.id]: client },
          sessionsDirty: false,
          sessionsError: null,
        });
      } catch {
        if (previous) {
          set({ sessionCache: { ...get().sessionCache, [snapshot.id]: previous } });
        }
        set({ sessionsDirty: true, sessionsError: COPILOT_SESSIONS_SAVE_FAILED });
      }
    };
    persistInFlight = run().finally(() => {
      persistInFlight = null;
    });
    await persistInFlight;
  },

  persistActiveSession: () => {
    const snapshot = buildActiveSessionSnapshot(get);
    if (!snapshot?.id) return;
    set({
      sessionCache: { ...get().sessionCache, [snapshot.id]: snapshot },
      sessions: get().sessions.map((row) =>
        row.id === snapshot.id
          ? { ...row, updated_at: snapshot.updated_at, model_id: snapshot.model_id, title: snapshot.title }
          : row,
      ),
    });
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void get().flushPersist();
    }, 400);
  },

  setModelId: (modelId) => {
    const model = findCachedModel(modelId);
    const reasoningEffort = resetReasoningForModel(model, get().reasoningEffort);
    set({ modelId, reasoningEffort, modelNotice: null });
    get().persistActiveSession();
  },

  dismissModelNotice: () => set({ modelNotice: null }),

  reconcileModelWithCatalog: () => {
    const { activeSessionId, modelId, sessionCache } = get();
    const response = getCachedModelsResponse();
    if (!activeSessionId || !response || response.models.length === 0) return;
    if (probeIncomplete()) return;
    const current = modelId ?? sessionCache[activeSessionId]?.model_id ?? null;
    const resolved = resolveSessionModelId(response.models, current, response.default_model);
    if (!resolved || resolved === modelId) return;
    const notice = switchNotice(response.models, current, resolved);
    get().setModelId(resolved);
    if (notice) set({ modelNotice: notice });
  },

  handleUnhealthyModel: async () => {
    const api = get().api;
    if (!api) return;
    await refreshCopilotModels(api);
    get().reconcileModelWithCatalog();
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
    set({
      lastAnalyzeMeta: meta,
      ...(meta?.candle_count_used != null ? { candleCount: meta.candle_count_used } : {}),
    });
    get().persistActiveSession();
  },

  clearAnalyzeStreamState: () => {
    set({
      lastAnalyzeMeta: null,
      lastDetectedRegime: null,
      streamingIntentCheck: null,
      lastAnalysisEvent: null,
    });
  },

  setLastDetectedRegime: (regime) => {
    set({ lastDetectedRegime: regime });
  },

  setStreamingIntentCheck: (check) => {
    set({ streamingIntentCheck: check });
  },

  setLastAnalysisEvent: (analysis) => {
    set({ lastAnalysisEvent: analysis });
  },

  createSession: async () => {
    const api = get().api;
    await get().flushPersist();
    const models = getModelsList();
    const modelId =
      resolveModel(models, get().modelId, getDefaultModelId()) ??
      resolveCatalogDefaultId(models, getDefaultModelId());
    if (!modelId) {
      set({ sessionsError: COPILOT_SESSIONS_OFFLINE });
      return;
    }
    const draft = buildEmptyClientSession(modelId, "Phiên mới", get().reasoningEffort);
    draft.chart.candle_count = get().getRequestedCandleCount();

    const previousSessions = get().sessions;
    const optimisticRow = summaryFromClientSession(draft);

    set({
      sessions: [optimisticRow, ...previousSessions],
      activeSessionId: draft.id,
      lastAnalyzeMeta: null,
      lastDetectedRegime: null,
      streamingIntentCheck: null,
      lastAnalysisEvent: null,
      sessionCache: { ...get().sessionCache, [draft.id]: draft },
    });
    useAiStore.setState({ messages: [], lastError: null, inFlight: false });
    applySessionToUi(draft);

    if (!api) {
      set({ sessionsDirty: true, sessionsError: COPILOT_SESSIONS_OFFLINE });
      return;
    }

    try {
      const created = await api.createSession(clientSessionToCreateBody(draft));
      const client = apiSessionToClient(created);
      const row = summaryFromApiSession(created);
      const cache = { ...get().sessionCache };
      delete cache[draft.id];
      cache[created.id] = client;
      set({
        sessions: [row, ...previousSessions],
        activeSessionId: created.id,
        sessionCache: cache,
        sessionsError: null,
        listFetchedAt: Date.now(),
      });
      saveActiveSessionId(created.id);
    } catch {
      set({
        sessions: previousSessions,
        activeSessionId: previousSessions[0]?.id ?? null,
        sessionsError: COPILOT_SESSIONS_SAVE_FAILED,
      });
      if (previousSessions[0]?.id) {
        const cached = get().sessionCache[previousSessions[0].id];
        if (cached) applySessionToUi(cached);
      }
    }
  },

  switchSession: async (id) => {
    if (id === get().activeSessionId) return;
    await get().flushPersist();
    const api = get().api;
    let session = get().sessionCache[id];
    if (!session && api) {
      try {
        const apiSession = await repairLegacyEncodedSessionTitle(api, await api.getSession(id));
        session = apiSessionToClient(apiSession);
        set({ sessionCache: { ...get().sessionCache, [id]: session } });
      } catch {
        set({ sessionsError: COPILOT_SESSIONS_OFFLINE });
        return;
      }
    }
    if (!session) return;

    saveActiveSessionId(id);
    const models = getModelsList();
    const apiDefault = getDefaultModelId();
    const resolvedId = resolveModel(models, session.model_id, apiDefault);
    const model = findCachedModel(resolvedId);
    set({
      modelNotice: switchNotice(models, session.model_id, resolvedId),
      activeSessionId: id,
      modelId: resolvedId,
      candleCount: session.chart.candle_count,
      customCandleCount: null,
      lastAnalyzeMeta: null,
      lastDetectedRegime: null,
      streamingIntentCheck: null,
      lastAnalysisEvent: null,
      reasoningEffort: resetReasoningForModel(model, session.reasoning_effort ?? null),
    });
    applySessionToUi({ ...session, model_id: resolvedId ?? session.model_id });
  },

  renameSession: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const api = get().api;
    const cached = get().sessionCache[id];
    const previousTitle = get().sessions.find((s) => s.id === id)?.title;
    set({
      sessions: get().sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
    });
    if (cached) {
      set({
        sessionCache: {
          ...get().sessionCache,
          [id]: { ...cached, title: trimmed, updated_at: Math.floor(Date.now() / 1000) },
        },
      });
    }
    if (!api) {
      set({ sessionsDirty: true, sessionsError: COPILOT_SESSIONS_OFFLINE });
      return;
    }
    try {
      const session = get().sessionCache[id] ?? cached;
      if (!session) return;
      const updated = await api.updateSession(id, { title: trimmed });
      const client = apiSessionToClient(updated);
      set({
        sessionCache: { ...get().sessionCache, [id]: client },
        sessions: get().sessions.map((s) =>
          s.id === id ? { ...summaryFromApiSession(updated), title: trimmed } : s,
        ),
      });
    } catch {
      if (previousTitle) {
        set({
          sessions: get().sessions.map((s) => (s.id === id ? { ...s, title: previousTitle } : s)),
        });
      }
      set({ sessionsError: COPILOT_SESSIONS_SAVE_FAILED });
    }
  },

  deleteSession: async (id) => {
    const api = get().api;
    const previousSessions = get().sessions;
    const previousActive = get().activeSessionId;
    const previousCache = get().sessionCache;
    const wasActive = id === previousActive;
    const remaining = previousSessions.filter((s) => s.id !== id);

    if (wasActive) {
      await get().flushPersist();
      if (remaining.length === 0) {
        set({ sessions: [] });
      } else {
        const nextId = remaining[0]!.id;
        saveActiveSessionId(nextId);
        const session = previousCache[nextId];
        if (session) {
          set({
            sessions: remaining,
            activeSessionId: nextId,
            sessionCache: { ...previousCache },
          });
          applySessionToUi(session);
        }
      }
    } else {
      set({ sessions: remaining });
    }

    const cache = { ...get().sessionCache };
    delete cache[id];
    set({ sessionCache: cache });

    if (wasActive && remaining.length === 0) {
      await get().createSession();
    }

    if (!api) {
      set({ sessionsDirty: true, sessionsError: COPILOT_SESSIONS_OFFLINE });
      return;
    }
    try {
      await api.deleteSession(id);
      set({ listFetchedAt: Date.now(), sessionsError: null });
    } catch {
      set({
        sessions: previousSessions,
        sessionCache: previousCache,
        activeSessionId: previousActive,
        sessionsError: COPILOT_SESSIONS_SAVE_FAILED,
      });
      if (previousActive && previousCache[previousActive]) {
        applySessionToUi(previousCache[previousActive]);
      }
      saveActiveSessionId(previousActive);
    }
  },

  recordAnalysisWindow: (from, to) => {
    set({ chartFrom: from, chartTo: to });
    get().persistActiveSession();
  },

  setSessionIntent: async (intent) => {
    const api = get().api;
    const id = get().activeSessionId;
    if (!api || !id) return;
    const cached = get().sessionCache[id];
    if (!cached) return;
    const previous = cached.intent ?? null;
    const optimistic: CopilotSessionV1 = {
      ...cached,
      intent,
      updated_at: Math.floor(Date.now() / 1000),
    };
    set({ sessionCache: { ...get().sessionCache, [id]: optimistic } });
    try {
      const updated = await api.updateSession(id, { intent });
      const client = apiSessionToClient(updated);
      set({
        sessionCache: { ...get().sessionCache, [id]: client },
        sessionsError: null,
      });
    } catch (err) {
      set({
        sessionCache: {
          ...get().sessionCache,
          [id]: { ...cached, intent: previous },
        },
      });
      const message =
        err instanceof CopilotApiError
          ? mapCopilotHttpError(err.status, err.body)
          : COPILOT_SESSIONS_SAVE_FAILED;
      useAiStore.getState().fail(message);
    }
  },
}));
