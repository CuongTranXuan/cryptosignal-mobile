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

/** Efforts the user can pick (excludes lone `none` — backend rejects reasoning_effort for those models). */
export function meaningfulReasoningEfforts(model: CopilotModelRecord | null): string[] {
  if (!model?.supports_reasoning) return [];
  const efforts = (model.reasoning_efforts ?? []).map((e) => e.toLowerCase());
  const withoutNoneOnly =
    efforts.length === 1 && efforts[0] === "none" ? [] : efforts.filter((e) => e !== "none");
  if (withoutNoneOnly.length > 0) {
    return withoutNoneOnly;
  }
  return efforts.filter((e) => e !== "none");
}

export function modelShowsReasoningSelector(model: CopilotModelRecord | null): boolean {
  return meaningfulReasoningEfforts(model).length > 0;
}

export function allowedUiReasoningLevels(model: CopilotModelRecord | null): UiReasoningLevel[] {
  if (!modelShowsReasoningSelector(model)) return [];
  const efforts = new Set((model?.reasoning_efforts ?? []).map((e) => e.toLowerCase()));
  const levels: UiReasoningLevel[] = [];
  if (efforts.has("none")) levels.push("off");
  if (efforts.has("low")) levels.push("low");
  if (efforts.has("medium")) levels.push("medium");
  if (efforts.has("high")) levels.push("high");
  return levels;
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
  const allowed = new Set(meaningfulReasoningEfforts(model));
  const normalized = storedApiEffort.toLowerCase();
  if (normalized === "none") return null;
  if (!allowed.has(normalized)) {
    if (allowed.has("low")) return "low";
    return null;
  }
  return normalized;
}

export function defaultReasoningEffortForModel(model: CopilotModelRecord | null): string | null {
  if (!modelShowsReasoningSelector(model)) return null;
  const allowed = meaningfulReasoningEfforts(model);
  if (allowed.includes("low")) return "low";
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
