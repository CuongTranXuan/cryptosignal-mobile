import { useEffect, useSyncExternalStore } from "react";
import { CopilotProbeRateLimitError, type CopilotApiClient } from "../../lib/copilot-api";
import type {
  CopilotModelRecord,
  ModelProbeReport,
  ModelsListResponse,
} from "../../lib/copilot-schema";
import { getCachedModelsResponse, loadCopilotModels } from "../../lib/copilot-models-cache";
import { nextModelsRefetchDelayMs } from "../../lib/copilot-model-probe";
import { COPILOT_PROBE_FAILED } from "../../lib/copilot-strings";

export type ModelsSnapshot = {
  response: ModelsListResponse | null;
  report: ModelProbeReport | null;
  loading: boolean;
  error: string | null;
  probing: boolean;
  probeError: string | null;
  /** Epoch ms until which re-probe is blocked after a 429. */
  rateLimitedUntil: number | null;
};

const INITIAL_SNAPSHOT: ModelsSnapshot = {
  response: null,
  report: null,
  loading: false,
  error: null,
  probing: false,
  probeError: null,
  rateLimitedUntil: null,
};

let snapshot: ModelsSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();
let boundApi: CopilotApiClient | null = null;
let inflight: Promise<ModelsListResponse> | null = null;
let reportRequested = false;

function snapshotsEqual(a: ModelsSnapshot, b: ModelsSnapshot): boolean {
  return (Object.keys(a) as (keyof ModelsSnapshot)[]).every((key) => a[key] === b[key]);
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function patchSnapshot(patch: Partial<ModelsSnapshot>): void {
  const next = { ...snapshot, ...patch };
  if (snapshotsEqual(snapshot, next)) return;
  snapshot = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ModelsSnapshot {
  return snapshot;
}

/** Latest probe report (hidden models and their reasons), if the backend has one. */
export function getModelProbeReport(): ModelProbeReport | null {
  return snapshot.report;
}

/** Hydrate external store after cache is populated elsewhere (e.g. session bootstrap). */
export function syncModelsSnapshotFromCache(): void {
  const cached = getCachedModelsResponse();
  if (!cached) return;
  patchSnapshot({ response: cached, loading: false, error: null });
}

/** Test-only reset. */
export function resetCopilotModelsStoreForTests(): void {
  snapshot = INITIAL_SNAPSHOT;
  listeners.clear();
  boundApi = null;
  inflight = null;
  reportRequested = false;
}

function bindApi(api: CopilotApiClient): void {
  if (boundApi === api) return;
  boundApi = api;
  inflight = null;
  reportRequested = false;
}

async function loadProbeReport(api: CopilotApiClient): Promise<void> {
  try {
    patchSnapshot({ report: await api.fetchModelProbeReport() });
  } catch {
    // The report only explains hidden models; the picker works without it.
  }
}

function ensureCopilotModelsLoaded(api: CopilotApiClient): void {
  bindApi(api);
  if (!reportRequested) {
    reportRequested = true;
    void loadProbeReport(api);
  }

  const cached = getCachedModelsResponse();
  if (cached) {
    patchSnapshot({ response: cached, loading: false, error: null });
    return;
  }

  if (inflight) return;

  patchSnapshot({ loading: true, error: null });
  inflight = loadCopilotModels(api)
    .then((response) => {
      patchSnapshot({ response, loading: false, error: null });
      return response;
    })
    .catch(() => {
      patchSnapshot({ loading: false, error: "models_unavailable" });
      throw new Error("models_unavailable");
    })
    .finally(() => {
      inflight = null;
    });
}

/** Re-read `/models` and the probe report (after TTL, a stale result, or an unhealthy-model error). */
export async function refreshCopilotModels(api: CopilotApiClient): Promise<void> {
  bindApi(api);
  try {
    const response = await loadCopilotModels(api, { force: true });
    patchSnapshot({ response, error: null });
  } catch {
    patchSnapshot({ error: "models_unavailable" });
  }
  await loadProbeReport(api);
}

/** `POST /models/probe`, then refresh `/models`; a 429 blocks re-probe for Retry-After seconds. */
export async function reprobeCopilotModels(
  api: CopilotApiClient,
  now: () => number = Date.now,
): Promise<void> {
  bindApi(api);
  if (snapshot.probing) return;
  if (snapshot.rateLimitedUntil != null && snapshot.rateLimitedUntil > now()) return;
  patchSnapshot({ probing: true, probeError: null, rateLimitedUntil: null });
  try {
    const report = await api.runModelProbe();
    const response = await loadCopilotModels(api, { force: true });
    patchSnapshot({ report, response, error: null, probing: false });
  } catch (err) {
    if (err instanceof CopilotProbeRateLimitError) {
      patchSnapshot({ probing: false, rateLimitedUntil: now() + err.retryAfterS * 1000 });
    } else {
      patchSnapshot({ probing: false, probeError: COPILOT_PROBE_FAILED });
    }
  }
}

export function useCopilotModels(api: CopilotApiClient | null): {
  models: CopilotModelRecord[];
  defaultModelId: string | null;
  loading: boolean;
  error: string | null;
} & ModelsSnapshot {
  useEffect(() => {
    if (!api) return;
    ensureCopilotModelsLoaded(api);
  }, [api]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...state,
    models: state.response?.models ?? [],
    defaultModelId: state.response?.default_model ?? null,
  };
}

/** Schedules one gentle `/models` refetch based on probe TTL / stale / in-progress flags. */
export function useCopilotModelsAutoRefresh(
  api: CopilotApiClient | null,
  response: ModelsListResponse | null,
  report: ModelProbeReport | null = null,
): void {
  useEffect(() => {
    if (!api) return;
    const delay = nextModelsRefetchDelayMs(response, Date.now(), report);
    if (delay == null) return;
    const timer = window.setTimeout(() => void refreshCopilotModels(api), delay);
    return () => window.clearTimeout(timer);
  }, [api, response, report]);
}
