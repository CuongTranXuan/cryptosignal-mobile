import { useSyncExternalStore } from "react";
import type { CopilotApiClient } from "../../lib/copilot-api";
import type { CopilotModelRecord, ModelsListResponse } from "../../lib/copilot-schema";
import { loadCopilotModels } from "../../lib/copilot-models-cache";

type ModelsSnapshot = {
  response: ModelsListResponse | null;
  loading: boolean;
  error: string | null;
};

let snapshot: ModelsSnapshot = { response: null, loading: false, error: null };
const listeners = new Set<() => void>();
let boundApi: CopilotApiClient | null = null;
let started = false;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ModelsSnapshot {
  return snapshot;
}

export function ensureCopilotModelsLoaded(api: CopilotApiClient): void {
  if (boundApi !== api) {
    boundApi = api;
    started = false;
  }
  if (started) return;
  started = true;
  snapshot = { ...snapshot, loading: true, error: null };
  emit();
  void loadCopilotModels(api)
    .then((response) => {
      snapshot = { response, loading: false, error: null };
      emit();
    })
    .catch(() => {
      snapshot = { response: snapshot.response, loading: false, error: "models_unavailable" };
      emit();
    });
}

export function useCopilotModels(api: CopilotApiClient | null): {
  models: CopilotModelRecord[];
  defaultModelId: string | null;
  loading: boolean;
  error: string | null;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (api) {
    ensureCopilotModelsLoaded(api);
  }
  return {
    models: state.response?.models ?? [],
    defaultModelId: state.response?.default_model ?? null,
    loading: state.loading,
    error: state.error,
  };
}
