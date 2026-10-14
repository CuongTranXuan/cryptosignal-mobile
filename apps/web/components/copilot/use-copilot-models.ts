import { useEffect, useSyncExternalStore } from "react";
import type { CopilotApiClient } from "../../lib/copilot-api";
import type { CopilotModelRecord, ModelsListResponse } from "../../lib/copilot-schema";
import { getCachedModelsResponse, loadCopilotModels } from "../../lib/copilot-models-cache";

type ModelsSnapshot = {
  response: ModelsListResponse | null;
  loading: boolean;
  error: string | null;
};

const INITIAL_SNAPSHOT: ModelsSnapshot = { response: null, loading: false, error: null };

let snapshot: ModelsSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();
let boundApi: CopilotApiClient | null = null;
let inflight: Promise<ModelsListResponse> | null = null;

function snapshotsEqual(a: ModelsSnapshot, b: ModelsSnapshot): boolean {
  return a.response === b.response && a.loading === b.loading && a.error === b.error;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setSnapshot(next: ModelsSnapshot): void {
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

/** Hydrate external store after cache is populated elsewhere (e.g. session bootstrap). */
export function syncModelsSnapshotFromCache(): void {
  const cached = getCachedModelsResponse();
  if (!cached) return;
  setSnapshot({ response: cached, loading: false, error: null });
}

/** Test-only reset. */
export function resetCopilotModelsStoreForTests(): void {
  snapshot = INITIAL_SNAPSHOT;
  listeners.clear();
  boundApi = null;
  inflight = null;
}

function ensureCopilotModelsLoaded(api: CopilotApiClient): void {
  if (boundApi !== api) {
    boundApi = api;
    inflight = null;
  }

  const cached = getCachedModelsResponse();
  if (cached) {
    setSnapshot({ response: cached, loading: false, error: null });
    return;
  }

  if (inflight) return;

  setSnapshot({ response: snapshot.response, loading: true, error: null });
  inflight = loadCopilotModels(api)
    .then((response) => {
      setSnapshot({ response, loading: false, error: null });
      return response;
    })
    .catch(() => {
      setSnapshot({
        response: snapshot.response,
        loading: false,
        error: "models_unavailable",
      });
      throw new Error("models_unavailable");
    })
    .finally(() => {
      inflight = null;
    });
}

export function useCopilotModels(api: CopilotApiClient | null): {
  models: CopilotModelRecord[];
  defaultModelId: string | null;
  loading: boolean;
  error: string | null;
} {
  useEffect(() => {
    if (!api) return;
    ensureCopilotModelsLoaded(api);
  }, [api]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    models: state.response?.models ?? [],
    defaultModelId: state.response?.default_model ?? null,
    loading: state.loading,
    error: state.error,
  };
}
