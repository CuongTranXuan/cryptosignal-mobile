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
  if (savedId && models.some((m) => m.id === savedId)) {
    return savedId;
  }
  if (models.some((m) => m.id === PREFERRED_DEFAULT_MODEL_ID)) {
    return PREFERRED_DEFAULT_MODEL_ID;
  }
  if (apiDefaultId && models.some((m) => m.id === apiDefaultId)) {
    return apiDefaultId;
  }
  return models[0]?.id ?? null;
}
