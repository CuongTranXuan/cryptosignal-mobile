import type { CopilotApiClient } from "./copilot-api";
import type { ModelsListResponse } from "./copilot-schema";
import { findModelById } from "./copilot-api";
import type { CopilotModelRecord } from "./copilot-schema";

/** Spec §4: client caches `/models` with the same 10 min TTL as the server. */
export const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

type ModelsCacheEntry = {
  response: ModelsListResponse;
  fetchedAt: number;
};

let cache: ModelsCacheEntry | null = null;
let inflight: Promise<ModelsListResponse> | null = null;

export function clearCopilotModelsCache(): void {
  cache = null;
  inflight = null;
}

export function getCachedModelsResponse(): ModelsListResponse | null {
  if (!cache) return null;
  if (Date.now() - cache.fetchedAt > MODELS_CACHE_TTL_MS) {
    cache = null;
    return null;
  }
  return cache.response;
}

export async function loadCopilotModels(
  api: CopilotApiClient,
  opts: { force?: boolean; query?: string } = {},
): Promise<ModelsListResponse> {
  const cached = !opts.force ? getCachedModelsResponse() : null;
  if (cached && !opts.query) {
    return cached;
  }
  if (!opts.force && inflight) {
    return inflight;
  }
  inflight = api.fetchModels(opts.query).then((response) => {
    cache = { response, fetchedAt: Date.now() };
    inflight = null;
    return response;
  });
  try {
    return await inflight;
  } catch (err) {
    inflight = null;
    throw err;
  }
}

export function getModelsList(): CopilotModelRecord[] {
  return getCachedModelsResponse()?.models ?? [];
}

export function getDefaultModelId(): string | null {
  return getCachedModelsResponse()?.default_model ?? null;
}

export function findCachedModel(modelId: string | null): CopilotModelRecord | null {
  return findModelById(getModelsList(), modelId);
}
