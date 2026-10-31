import type { CopilotModelRecord } from "./copilot-schema";

/** Catalog default: API `default_model` when listed, else first model. */
export function resolveCatalogDefaultId(
  models: CopilotModelRecord[],
  apiDefaultId: string | null | undefined,
): string | null {
  if (apiDefaultId?.trim() && models.some((m) => m.id === apiDefaultId)) {
    return apiDefaultId;
  }
  return models[0]?.id ?? null;
}

/**
 * Saved session id when still in catalog; otherwise catalog default (API default_model, else first).
 */
export function resolveDefaultModelId(
  models: CopilotModelRecord[],
  savedId: string | null | undefined,
  apiDefaultId: string | null | undefined,
): string | null {
  const trimmed = savedId?.trim();
  if (trimmed && models.some((m) => m.id === trimmed)) {
    return trimmed;
  }
  return resolveCatalogDefaultId(models, apiDefaultId);
}

export function resolveSessionModelId(
  models: CopilotModelRecord[],
  savedId: string | null | undefined,
  apiDefaultId: string | null | undefined,
): string | null {
  return resolveDefaultModelId(models, savedId, apiDefaultId);
}

/** Analyze body: omit model when id is not in the discovered catalog (server default applies). */
export function modelIdForAnalyzeRequest(
  models: CopilotModelRecord[],
  sessionModelId: string | null | undefined,
  apiDefaultId: string | null | undefined,
): string | undefined {
  const candidate = resolveSessionModelId(models, sessionModelId, apiDefaultId);
  if (!candidate || !models.some((m) => m.id === candidate)) {
    return undefined;
  }
  return candidate;
}

export function modelLabelForSession(
  models: CopilotModelRecord[],
  sessionModelId: string | null | undefined,
  apiDefaultId: string | null | undefined,
): string {
  const id = resolveSessionModelId(models, sessionModelId, apiDefaultId);
  if (!id) return "";
  const hit = models.find((m) => m.id === id);
  if (hit) return `${hit.provider} · ${hit.label}`;
  return id;
}
