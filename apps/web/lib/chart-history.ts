/**
 * Per-session chart history: shapes, markers, analysis and view saved per
 * (session, symbol, interval) on the copilot backend (see lib/chart-state.ts for the wire).
 *
 * - switchChart / activateChartSession: flush the pending save for the chart we leave, clear
 *   overlays at once (no stale drawings), GET the target doc and paint it (404 → clean chart).
 * - User edits (shape-store user-edit listener) and view changes → debounced PUT with the base
 *   revision; 409 → merge (server AI shapes + local pins/user shapes) and retry once.
 * - 5xx / network → "chưa lưu" + background retry with backoff (2 s, 4 s … 60 s, never sooner
 *   than Retry-After, e.g. 5 s on 503 db_unavailable) until saved; the same for an analyze
 *   autosave that reports `chart_state_error: db_unavailable`.
 *   413/422 (and a stray 400/401/403) → Vietnamese notice + "chưa lưu", no retry.
 *   404 session_not_found → the session is gone (or another device's): session store moves on.
 *   Local edits always stay.
 * - Analyze saves server-side; the client only records `chart_state_revision` (no PUT back).
 */
import { create } from "zustand";
import { parseAnalysisSseEvent } from "./copilot-chart-ai";
import { CopilotApiError, isSessionGoneError } from "./copilot-api";
import type { CopilotSessionV1 } from "./copilot-schema";
import {
  CHART_HISTORY_CONFLICT,
  CHART_HISTORY_SAVE_FAILED,
  chartHistoryTooLarge,
  CHART_HISTORY_SERVER_SAVE_FAILED,
  CHART_HISTORY_SESSION_MISSING,
} from "./copilot-strings";
import {
  chartConflictCurrent,
  chartKey,
  chartInvalidNotice,
  chartTooLargeNotice,
  chartTooLargeText,
  sanitizeChartPutBody,
  isChartStateNotFound,
  type ChartIndexEntry,
  type ChartStateApi,
  type ChartStateDoc,
  type ChartStatePutBody,
  type ChartView,
} from "./chart-state";
import { INTERVALS, type AgentMarker, type Interval, type PatternShape } from "./pattern-shape";
import { intervalBarSeconds } from "./shape-projection";
import { useChartStore } from "./stores/chart-store";
import { useCopilotSessionStore } from "./stores/copilot-session-store";
import { useMarkerStore } from "./stores/marker-store";
import {
  isPinnedShape,
  setShapeUserEditListener,
  shapeOrigin,
  useShapeStore,
} from "./stores/shape-store";

export const CHART_SAVE_DEBOUNCE_MS = 1000;
export const CHART_SAVE_RETRY_BASE_MS = 2000;
export const CHART_SAVE_RETRY_MAX_MS = 60_000;

/** Why a chart is not saved: "retrying" (5xx/network, backoff running) or "failed" (no retry). */
export type ChartUnsavedState = "retrying" | "failed";

export type ChartDocMeta = {
  revision: number | null;
  analysis: Record<string, unknown> | null;
  summary_text: string | null;
  view: ChartView | null;
  analyzed_at: number | null;
  /** Shape ids in the last saved/loaded doc; ids missing locally were deleted by the user. */
  savedShapeIds: string[];
};

type ChartHistoryState = {
  /** False once the backend has no chart endpoints: fall back to the old per-session behaviour. */
  supported: boolean;
  sessionId: string | null;
  index: ChartIndexEntry[];
  docs: Record<string, ChartDocMeta>;
  loadingKey: string | null;
  notice: string | null;
  /** Charts whose local state is not on the server yet. */
  unsaved: Record<string, ChartUnsavedState>;
  dismissNotice: () => void;
};

export const useChartHistoryStore = create<ChartHistoryState>((set) => ({
  supported: true,
  sessionId: null,
  index: [],
  docs: {},
  loadingKey: null,
  notice: null,
  unsaved: {},
  dismissNotice: () => set({ notice: null }),
}));

type Snapshot = { shapes: PatternShape[]; markers: AgentMarker[]; view: ChartView | null };

let api: ChartStateApi | null = null;
let getView: () => ChartView | null = () => null;
let applyView: (view: ChartView) => void = () => {};
let waitForCandles = false;
let candlesReadyPair: string | null = null;
let loadToken = 0;
let pendingPaint: { key: string; paint: () => void } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveKey: string | null = null;
let saveChain: Promise<void> = Promise.resolve();
/** Key of an analyze run in flight: its server-side save would make our base revision stale. */
let analyzeRunKey: string | null = null;
/** Local state not saved yet, per chart key (snapshot for retries / repaint after a switch). */
const unsavedSnaps = new Map<string, { snap: Snapshot; attempt: number; timer: ReturnType<typeof setTimeout> | null }>();

export function configureChartHistory(opts: {
  api: ChartStateApi | null;
  getView?: () => ChartView | null;
  applyView?: (view: ChartView) => void;
  /** Paint a loaded doc only after the target candles are on the chart (UI; tests skip it). */
  waitForCandles?: boolean;
}): void {
  api = opts.api;
  getView = opts.getView ?? (() => null);
  applyView = opts.applyView ?? (() => {});
  waitForCandles = opts.waitForCandles ?? false;
  setShapeUserEditListener(api ? scheduleChartSave : null);
}

export function resetChartHistoryForTests(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  pendingSaveKey = null;
  pendingPaint = null;
  candlesReadyPair = null;
  loadToken = 0;
  saveChain = Promise.resolve();
  analyzeRunKey = null;
  for (const entry of unsavedSnaps.values()) if (entry.timer) clearTimeout(entry.timer);
  unsavedSnaps.clear();
  api = null;
  setShapeUserEditListener(null);
  useChartHistoryStore.setState({
    supported: true,
    sessionId: null,
    index: [],
    docs: {},
    loadingKey: null,
    notice: null,
    unsaved: {},
  });
}

function parseKey(key: string): { sessionId: string; symbol: string; interval: Interval } {
  const [sessionId = "", symbol = "", interval = "1h"] = key.split("|");
  return { sessionId, symbol, interval: interval as Interval };
}

function pairOf(symbol: string, interval: Interval): string {
  return `${symbol.toUpperCase()}|${interval}`;
}

export function currentChartKey(): string | null {
  const { sessionId, supported } = useChartHistoryStore.getState();
  if (!api || !supported || !sessionId) return null;
  const chart = useChartStore.getState();
  return chartKey(sessionId, chart.symbol, chart.interval);
}

function localSnapshot(): Snapshot {
  return {
    shapes: useShapeStore
      .getState()
      .committed()
      .map((s) => ({ ...s, origin: shapeOrigin(s) })),
    markers: useMarkerStore.getState().markers,
    view: getView(),
  };
}

function metaFromDoc(doc: ChartStateDoc): ChartDocMeta {
  return {
    revision: doc.revision,
    analysis: doc.analysis ?? null,
    summary_text: doc.summary_text ?? null,
    view: doc.view ?? null,
    analyzed_at: doc.analyzed_at ?? null,
    savedShapeIds: doc.shapes.map((s) => s.id),
  };
}

function setDocMeta(key: string, meta: ChartDocMeta): void {
  useChartHistoryStore.setState({ docs: { ...useChartHistoryStore.getState().docs, [key]: meta } });
}

function upsertIndexEntry(key: string, doc: ChartStateDoc): void {
  const { sessionId, symbol, interval } = parseKey(key);
  const state = useChartHistoryStore.getState();
  if (state.sessionId !== sessionId) return;
  const entry: ChartIndexEntry = {
    symbol: doc.symbol || symbol,
    interval: doc.interval || interval,
    updated_at: doc.updated_at,
    revision: doc.revision,
    analyzed_at: doc.analyzed_at ?? null,
    shape_count: doc.shapes.length,
    has_analysis: doc.analysis != null,
  };
  const rest = state.index.filter((e) => !(e.symbol === entry.symbol && e.interval === entry.interval));
  useChartHistoryStore.setState({
    index: [entry, ...rest].sort((a, b) => b.updated_at - a.updated_at),
  });
}

/** Two bars of drift is noise (live candles, programmatic restore); more is a user pan/zoom. */
function viewChanged(prev: ChartView | null, next: ChartView | null, interval: Interval): boolean {
  if (!next) return false;
  if (!prev) return true;
  const tol = intervalBarSeconds(interval) * 2;
  return Math.abs(prev.from - next.from) > tol || Math.abs(prev.to - next.to) > tol;
}

/**
 * 409 merge: keep the server's shapes (its new AI run) except ones the user deleted locally,
 * then the local pinned/user shapes (they win on id clashes). Markers follow surviving shapes.
 */
export function mergeChartConflict(
  server: Pick<ChartStateDoc, "shapes" | "markers">,
  localShapes: PatternShape[],
  localMarkers: AgentMarker[],
  lastSavedShapeIds: readonly string[],
): { shapes: PatternShape[]; markers: AgentMarker[] } {
  const localIds = new Set(localShapes.map((s) => s.id));
  const deleted = new Set(lastSavedShapeIds.filter((id) => !localIds.has(id)));
  const localPinned = localShapes.filter(isPinnedShape);
  const pinnedIds = new Set(localPinned.map((s) => s.id));
  const shapes = [
    ...server.shapes.filter((s) => !deleted.has(s.id) && !pinnedIds.has(s.id)),
    ...localPinned,
  ];
  const onChart = new Set(shapes.map((s) => s.id));
  const seen = new Set<string>();
  const markers = [...localMarkers, ...server.markers].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return !m.drawing_id || onChart.has(m.drawing_id);
  });
  return { shapes, markers };
}

function putBody(snap: Snapshot, meta: ChartDocMeta | undefined, revision: number | null): ChartStatePutBody {
  const body: ChartStatePutBody = { shapes: snap.shapes, markers: snap.markers };
  if (meta?.analysis) body.analysis = meta.analysis;
  if (meta?.summary_text) body.summary_text = meta.summary_text;
  const view = snap.view ?? meta?.view ?? null;
  if (view) body.view = view;
  if (revision != null) body.revision = revision;
  return sanitizeChartPutBody(body);
}

function setNotice(notice: string | null): void {
  useChartHistoryStore.setState({ notice });
}

function onSaved(key: string, doc: ChartStateDoc): void {
  setDocMeta(key, metaFromDoc(doc));
  upsertIndexEntry(key, doc);
  clearUnsaved(key);
  if (useChartHistoryStore.getState().notice) setNotice(null);
}

function setUnsavedState(key: string, state: ChartUnsavedState | null): void {
  const { [key]: _prev, ...rest } = useChartHistoryStore.getState().unsaved;
  useChartHistoryStore.setState({ unsaved: state ? { ...rest, [key]: state } : rest });
}

function clearUnsaved(key: string): void {
  const entry = unsavedSnaps.get(key);
  if (entry?.timer) clearTimeout(entry.timer);
  unsavedSnaps.delete(key);
  if (useChartHistoryStore.getState().unsaved[key]) setUnsavedState(key, null);
}

/** `Retry-After` the backend sends with 503 db_unavailable (also used for the autosave meta). */
export const CHART_DB_RETRY_AFTER_MS = 5000;

/**
 * Backoff delay before retry number `attempt` (0-based): 2 s, 4 s, 8 s … capped at 60 s.
 * A server `Retry-After` is a floor: never retry sooner than it asks (still capped).
 */
export function chartSaveRetryDelay(attempt: number, retryAfterMs: number | null = null): number {
  const backoff = CHART_SAVE_RETRY_BASE_MS * 2 ** attempt;
  return Math.min(Math.max(backoff, retryAfterMs ?? 0), CHART_SAVE_RETRY_MAX_MS);
}

/** Keep `snap` as the unsaved local state of `key`; `retry` starts/continues the backoff. */
function markUnsaved(key: string, snap: Snapshot, retry: boolean, retryAfterMs: number | null = null): void {
  const entry = unsavedSnaps.get(key) ?? { snap, attempt: 0, timer: null };
  entry.snap = snap;
  unsavedSnaps.set(key, entry);
  if (!retry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.attempt = 0;
    setUnsavedState(key, "failed");
    return;
  }
  setUnsavedState(key, "retrying");
  if (entry.timer) return; // a retry is already scheduled; it will send the newest snapshot
  const delay = chartSaveRetryDelay(entry.attempt, retryAfterMs);
  entry.attempt += 1;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (unsavedSnaps.get(key) !== entry) return;
    if (analyzeRunKey === key) {
      // The run saves server-side; retry after it with the newest local state.
      markUnsaved(key, entry.snap, true);
      return;
    }
    void enqueueSave(key, currentChartKey() === key ? localSnapshot() : entry.snap);
  }, delay);
}

type SaveFailure = "retry" | "too_large" | "invalid" | "session_gone" | "no_route" | "other";

/**
 * 5xx (incl. 503 db_unavailable) / network → retry. Size and validation errors (400 malformed
 * JSON, 413, 422) never fix themselves → no retry. 401/403 are not used by the backend
 * (ownership is a 404) and fall through to the generic no-retry notice.
 */
export function classifyChartSaveError(err: unknown): SaveFailure {
  if (!(err instanceof CopilotApiError)) return "retry"; // fetch rejected: offline / network
  const { status } = err;
  if (status >= 500 || status === 408 || status === 429) return "retry";
  if (status === 413) return "too_large";
  if (status === 422 || status === 400) return "invalid";
  if (isSessionGoneError(err)) return "session_gone";
  if (status === 404 && !isChartStateNotFound(err)) return "no_route";
  return "other";
}

/** 404 session_not_found from a chart route: let the session store drop the session. */
function sessionGone(key: string): void {
  void useCopilotSessionStore.getState().handleSessionGone(parseKey(key).sessionId);
}

/** Shared failure path of a save attempt: notice (if any) and the "chưa lưu" state. */
function failSave(key: string, snap: Snapshot, err: unknown, otherNotice: string): void {
  switch (classifyChartSaveError(err)) {
    case "retry":
      markUnsaved(key, snap, true, err instanceof CopilotApiError ? err.retryAfterMs : null);
      return;
    case "too_large":
      setNotice(chartTooLargeNotice(err) ?? chartHistoryTooLarge(""));
      break;
    case "invalid":
      setNotice(chartInvalidNotice(err));
      break;
    case "session_gone":
      clearUnsaved(key);
      sessionGone(key);
      return;
    case "no_route":
      return; // older backend without chart routes: nothing to save into
    case "other":
      setNotice(otherNotice);
      break;
  }
  markUnsaved(key, snap, false);
}

function paintShapesAndMarkers(shapes: PatternShape[], markers: AgentMarker[]): void {
  useShapeStore.getState().setChartShapes(shapes);
  useMarkerStore.getState().setMarkers(markers);
}

/** Analysis card + detected regime of a saved chart (meta/HTF lines belong to a live run). */
function paintAnalysis(raw: Record<string, unknown> | null): void {
  const analysis = raw ? parseAnalysisSseEvent(raw) : null;
  const session = useCopilotSessionStore.getState();
  session.setLastAnalysisEvent(analysis);
  session.setLastDetectedRegime(analysis?.intent_check?.detected_regime ?? null);
}

async function doSave(key: string, snap: Snapshot): Promise<void> {
  if (!api) return;
  const { sessionId, symbol, interval } = parseKey(key);
  const meta = useChartHistoryStore.getState().docs[key];
  try {
    onSaved(key, await api.putChart(sessionId, symbol, interval, putBody(snap, meta, meta?.revision ?? null)));
    return;
  } catch (err) {
    const current = chartConflictCurrent(err);
    if (current) {
      const merged = { ...snap, ...mergeChartConflict(current, snap.shapes, snap.markers, meta?.savedShapeIds ?? []) };
      try {
        const saved = await api.putChart(sessionId, symbol, interval, putBody(merged, metaFromDoc(current), current.revision));
        onSaved(key, saved);
        if (currentChartKey() === key) {
          paintShapesAndMarkers(saved.shapes, saved.markers);
          paintAnalysis(saved.analysis ?? null);
        }
      } catch (retryErr) {
        failSave(key, merged, retryErr, CHART_HISTORY_CONFLICT);
      }
      return;
    }
    if (isChartStateNotFound(err) && meta?.revision != null) {
      // Doc was cleared elsewhere: create it again from the local state.
      try {
        onSaved(key, await api.putChart(sessionId, symbol, interval, putBody(snap, meta, null)));
      } catch (createErr) {
        failSave(key, snap, createErr, CHART_HISTORY_SAVE_FAILED);
      }
      return;
    }
    failSave(key, snap, err, CHART_HISTORY_SAVE_FAILED);
  }
}

function enqueueSave(key: string, snap: Snapshot): Promise<void> {
  saveChain = saveChain.then(() => doSave(key, snap)).catch(() => {});
  return saveChain;
}

/** Debounced (1 s) PUT of the current chart; called after user edits and view changes. */
export function scheduleChartSave(): void {
  const key = currentChartKey();
  if (!key) return;
  if (useChartHistoryStore.getState().loadingKey === key) return;
  pendingSaveKey = key;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    // Wait for the analyze run on this chart to finish (it saves server-side first).
    if (analyzeRunKey === key) {
      scheduleChartSave();
      return;
    }
    void flushChartSave();
  }, CHART_SAVE_DEBOUNCE_MS);
}

/**
 * Save the pending edit (or a changed view of a saved chart) now. The snapshot is taken
 * synchronously, so callers can switch the chart right after calling this.
 */
export function flushChartSave(): Promise<void> {
  const key = currentChartKey();
  const hadPending = saveTimer != null || pendingSaveKey != null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const pendingKey = pendingSaveKey;
  pendingSaveKey = null;
  if (!key || useChartHistoryStore.getState().loadingKey === key) return saveChain;
  const meta = useChartHistoryStore.getState().docs[key];
  const snap = localSnapshot();
  const interval = useChartStore.getState().interval;
  if ((hadPending && pendingKey === key) || (meta?.revision != null && viewChanged(meta.view, snap.view, interval))) {
    return enqueueSave(key, snap);
  }
  return saveChain;
}

/** Visible range moved (pan/zoom): save the view of a chart that already has a doc. */
export function notifyChartViewChanged(): void {
  const key = currentChartKey();
  if (!key) return;
  const state = useChartHistoryStore.getState();
  if (state.loadingKey === key) return;
  const meta = state.docs[key];
  if (meta?.revision == null) return;
  if (viewChanged(meta.view, getView(), useChartStore.getState().interval)) scheduleChartSave();
}

function queuePaint(key: string, paint: () => void): void {
  const { symbol, interval } = parseKey(key);
  if (!waitForCandles || candlesReadyPair === pairOf(symbol, interval)) {
    pendingPaint = null;
    paint();
    return;
  }
  pendingPaint = { key, paint };
}

/** Chart canvas replaced its candle series (new symbol/interval loaded). */
export function notifyCandlesReplaced(symbol: string, interval: Interval): void {
  candlesReadyPair = pairOf(symbol, interval);
  const pending = pendingPaint;
  if (!pending) return;
  const target = parseKey(pending.key);
  if (pairOf(target.symbol, target.interval) !== candlesReadyPair) return;
  pendingPaint = null;
  if (currentChartKey() === pending.key) pending.paint();
}

function paintDoc(key: string, doc: ChartStateDoc | null): void {
  if (doc) {
    setDocMeta(key, metaFromDoc(doc));
    paintShapesAndMarkers(doc.shapes, doc.markers);
    paintAnalysis(doc.analysis ?? null);
    if (doc.view) {
      applyView(doc.view);
      // The chart snaps the range to bars/right offset: compare future pans to what it shows.
      setTimeout(() => {
        const shown = getView();
        const meta = useChartHistoryStore.getState().docs[key];
        if (shown && meta && currentChartKey() === key) setDocMeta(key, { ...meta, view: shown });
      }, 50);
    }
  } else {
    paintShapesAndMarkers([], []);
    paintAnalysis(null);
  }
  if (useChartHistoryStore.getState().loadingKey === key) {
    useChartHistoryStore.setState({ loadingKey: null });
  }
}

/** A chart with a failing save keeps showing its local edits after a switch back. */
function paintUnsavedLocal(key: string): void {
  const entry = unsavedSnaps.get(key);
  if (entry) paintShapesAndMarkers(entry.snap.shapes, entry.snap.markers);
}

type Legacy = { shapes: PatternShape[]; markers: AgentMarker[] };

function legacyForKey(legacy: Legacy | undefined, symbol: string, interval: Interval): Legacy | null {
  if (!legacy) return null;
  const shapes = legacy.shapes.filter(
    (s) => s.symbol.toUpperCase() === symbol.toUpperCase() && s.interval === interval,
  );
  if (shapes.length === 0) return null;
  const ids = new Set(shapes.map((s) => s.id));
  return { shapes, markers: legacy.markers.filter((m) => !m.drawing_id || ids.has(m.drawing_id)) };
}

async function loadChart(key: string, legacy?: Legacy): Promise<void> {
  if (!api) return;
  const token = ++loadToken;
  const { sessionId, symbol, interval } = parseKey(key);
  pendingPaint = null;
  useChartHistoryStore.setState({ loadingKey: key });
  // Clear at once so the previous timeframe's drawings never flash on the new one.
  paintShapesAndMarkers([], []);
  useCopilotSessionStore.getState().clearAnalyzeStreamState();
  try {
    const doc = await api.getChart(sessionId, symbol, interval);
    if (token !== loadToken) return;
    queuePaint(key, () => {
      paintDoc(key, doc);
      paintUnsavedLocal(key);
    });
  } catch (err) {
    if (token !== loadToken) return;
    if (isSessionGoneError(err)) {
      useChartHistoryStore.setState({ loadingKey: null });
      sessionGone(key);
      return;
    }
    const own = legacyForKey(legacy, symbol, interval);
    if (unsavedSnaps.has(key)) {
      // Not on the server yet (save failing): the local edits are the truth.
      queuePaint(key, () => {
        paintDoc(key, null);
        paintUnsavedLocal(key);
      });
      return;
    }
    if (isChartStateNotFound(err)) {
      if (own) {
        // Session saved before chart history existed: keep its drawings and create the doc.
        queuePaint(key, () => {
          paintDoc(key, null);
          paintShapesAndMarkers(own.shapes, own.markers);
          void enqueueSave(key, { shapes: own.shapes, markers: own.markers, view: getView() });
        });
      } else {
        queuePaint(key, () => paintDoc(key, null));
      }
      return;
    }
    // No chart endpoints (older backend) or offline: previous behaviour.
    if (err instanceof CopilotApiError && err.status === 404) {
      useChartHistoryStore.setState({ supported: false });
    }
    useChartHistoryStore.setState({ loadingKey: null });
    if (legacy) paintShapesAndMarkers(legacy.shapes, legacy.markers);
  }
}

export async function refreshChartIndex(sessionId?: string): Promise<void> {
  const sid = sessionId ?? useChartHistoryStore.getState().sessionId;
  if (!api || !sid) return;
  try {
    const { charts } = await api.listCharts(sid);
    if (useChartHistoryStore.getState().sessionId === sid) {
      useChartHistoryStore.setState({ index: charts });
    }
  } catch (err) {
    if (isSessionGoneError(err)) {
      void useCopilotSessionStore.getState().handleSessionGone(sid);
      return;
    }
    if (err instanceof CopilotApiError && err.status === 404 && err.code !== "chart_state_not_found") {
      if (useChartHistoryStore.getState().sessionId === sid) {
        useChartHistoryStore.setState({ index: [] });
      }
    }
  }
}

/**
 * Session loaded (page load, switch, new session): `applySessionToUi` already set the chart
 * symbol/interval. Legacy message shapes are used only for older backends / migration.
 */
export function activateChartSession(session: Pick<CopilotSessionV1, "id">, legacy: Legacy): void {
  if (!api) {
    paintShapesAndMarkers(legacy.shapes, legacy.markers);
    return;
  }
  useChartHistoryStore.setState({
    sessionId: session.id,
    supported: true,
    index: [],
    notice: null,
  });
  const key = currentChartKey();
  if (!key) return;
  void loadChart(key, legacy);
  void refreshChartIndex(session.id);
}

/** Timeframe/symbol switch from the top bar or a history chip. */
export function switchChart(symbol: string, interval: Interval): void {
  const chart = useChartStore.getState();
  const nextSymbol = symbol.toUpperCase();
  if (nextSymbol === chart.symbol && interval === chart.interval) return;
  void flushChartSave();
  if (nextSymbol !== chart.symbol) chart.setSymbol(nextSymbol);
  if (interval !== chart.interval) chart.setInterval(interval);
  const key = currentChartKey();
  if (key) {
    void loadChart(key);
  } else {
    // Old behaviour without chart history: a new chart starts clean.
    useChartStore.getState().resetShapesSignal();
  }
  useCopilotSessionStore.getState().persistActiveSession();
}

/** Analyze is starting on `key`: save pending edits first so the server sees the pins. */
export function beginAnalyzeRun(): { key: string | null; flushed: Promise<void> } {
  const flushed = flushChartSave();
  analyzeRunKey = currentChartKey();
  return { key: analyzeRunKey, flushed };
}

/** Analyze stream ended (done, error or abort); deferred saves may run again. */
export function endAnalyzeRun(): void {
  analyzeRunKey = null;
}

/** Analyze finished and the server saved the doc (`chart_state_revision`); no PUT back. */
export function recordAnalyzeSaved(
  key: string,
  revision: number,
  analysis: Record<string, unknown> | null,
): void {
  const prev = useChartHistoryStore.getState().docs[key];
  setDocMeta(key, {
    revision,
    analysis: analysis ?? prev?.analysis ?? null,
    summary_text: prev?.summary_text ?? null,
    view: prev?.view ?? null,
    analyzed_at: Math.floor(Date.now() / 1000),
    savedShapeIds:
      currentChartKey() === key
        ? useShapeStore.getState().committed().map((s) => s.id)
        : (prev?.savedShapeIds ?? []),
  });
  void refreshChartIndex(parseKey(key).sessionId);
}

/** Save the local state of `key` now (N25: server saved shapes the client could not draw). */
export function saveChartNow(key: string): Promise<void> {
  if (currentChartKey() !== key) return saveChain;
  return enqueueSave(key, localSnapshot());
}

/** Analyze autosave hit a size cap (`chart_state_error: chart_state_too_large` + `field` + `limit`). */
export function noteChartTooLarge(field: string | null = null, limit: number | null = null): void {
  setNotice(chartTooLargeText({ code: "chart_state_too_large", field, limit }));
}

/**
 * Analyze autosave could not reach the database (`chart_state_error: db_unavailable`): the run
 * is only on this device. Show "chưa lưu" and save it with the backoff (from Retry-After 5 s).
 */
export function retryChartSaveLater(key: string): void {
  if (currentChartKey() !== key) return;
  markUnsaved(key, localSnapshot(), true, CHART_DB_RETRY_AFTER_MS);
}

/** Final analyze meta carried `chart_state_error` (backend did not save this run). */
export function noteChartStateError(code: string): void {
  setNotice(
    code === "session_not_found" ? CHART_HISTORY_SESSION_MISSING : CHART_HISTORY_SERVER_SAVE_FAILED,
  );
}

/** Wait for queued PUTs (tests, e2e). */
export function chartSavesSettled(): Promise<void> {
  return saveChain;
}

export function intervalOrder(interval: Interval): number {
  return INTERVALS.indexOf(interval);
}
