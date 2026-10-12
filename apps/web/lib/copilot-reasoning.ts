import type { CopilotModelRecord } from "./copilot-schema";

export type UiReasoningLevel = "off" | "low" | "medium" | "high";

const UI_TO_API: Record<UiReasoningLevel, string> = {
  off: "none",
  low: "low",
  medium: "medium",
  high: "high",
};

const API_TO_UI: Record<string, UiReasoningLevel> = {
  none: "off",
  off: "off",
  low: "low",
  medium: "medium",
  high: "high",
};

export function modelShowsReasoningSelector(model: CopilotModelRecord | null): boolean {
  if (!model || !model.supports_reasoning) return false;
  const efforts = model.reasoning_efforts ?? [];
  return efforts.length > 0;
}

export function allowedUiReasoningLevels(model: CopilotModelRecord | null): UiReasoningLevel[] {
  if (!modelShowsReasoningSelector(model)) return [];
  const efforts = new Set((model?.reasoning_efforts ?? []).map((e) => e.toLowerCase()));
  const levels: UiReasoningLevel[] = ["off", "low", "medium", "high"];
  return levels.filter((level) => {
    const api = UI_TO_API[level];
    return efforts.has(api);
  });
}

export function uiReasoningToApi(level: UiReasoningLevel): string {
  return UI_TO_API[level];
}

export function apiReasoningToUi(apiValue: string | null | undefined): UiReasoningLevel | null {
  if (!apiValue) return null;
  return API_TO_UI[apiValue.toLowerCase()] ?? null;
}

/** Value sent on analyze; `null` means omit `reasoning_effort`. */
export function reasoningEffortForAnalyze(
  model: CopilotModelRecord | null,
  storedApiEffort: string | null,
): string | null {
  if (!modelShowsReasoningSelector(model) || !storedApiEffort) return null;
  const allowed = new Set((model?.reasoning_efforts ?? []).map((e) => e.toLowerCase()));
  const normalized = storedApiEffort.toLowerCase();
  if (!allowed.has(normalized)) {
    if (allowed.has("low")) return "low";
    if (allowed.has("none")) return "none";
    return null;
  }
  return normalized;
}

export function defaultReasoningEffortForModel(model: CopilotModelRecord | null): string | null {
  if (!modelShowsReasoningSelector(model)) return null;
  const allowed = model?.reasoning_efforts ?? [];
  if (allowed.includes("low")) return "low";
  if (allowed.includes("none")) return "none";
  return allowed[0] ?? null;
}

export function resetReasoningForModel(
  model: CopilotModelRecord | null,
  previousApiEffort: string | null,
): string | null {
  if (!modelShowsReasoningSelector(model)) return null;
  const effort = reasoningEffortForAnalyze(model, previousApiEffort);
  return effort ?? defaultReasoningEffortForModel(model);
}
