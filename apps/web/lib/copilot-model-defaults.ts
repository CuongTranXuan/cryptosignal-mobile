import type { CopilotModelRecord } from "./copilot-schema";

export const PREFERRED_DEFAULT_MODEL_ID = "agentrouter/deepseek-v4-flash";

/**
 * Product default: prefer deepseek-v4-flash, then API default_model, then first listed model.
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
  if (models.some((m) => m.id === PREFERRED_DEFAULT_MODEL_ID)) {
    return PREFERRED_DEFAULT_MODEL_ID;
  }
  if (apiDefaultId && models.some((m) => m.id === apiDefaultId)) {
    return apiDefaultId;
  }
  return models[0]?.id ?? null;
}

/** UI/session id: never empty; falls back to preferred id even when catalog is empty. */
export function resolveSessionModelId(
  models: CopilotModelRecord[],
  savedId: string | null | undefined,
  apiDefaultId: string | null | undefined,
): string {
  return (
    resolveDefaultModelId(models, savedId, apiDefaultId) ?? PREFERRED_DEFAULT_MODEL_ID
  );
}

/** Analyze body: omit model when id is not in the discovered catalog (server default applies). */
export function modelIdForAnalyzeRequest(
  models: CopilotModelRecord[],
  sessionModelId: string | null | undefined,
  apiDefaultId: string | null | undefined,
): string | undefined {
  const candidate = resolveSessionModelId(models, sessionModelId, apiDefaultId);
  if (!models.some((m) => m.id === candidate)) {
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
  const hit = models.find((m) => m.id === id);
  if (hit) return `${hit.provider} · ${hit.label}`;
  return id;
}
