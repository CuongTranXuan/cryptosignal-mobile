import type { AnalyzeIntent } from "./copilot-schema";
import { DEFAULT_ANALYZE_INTENT } from "./copilot-chart-ai";

const STORAGE_KEY = "copilot.chart_intent.v1";

type IntentMap = Record<string, AnalyzeIntent>;

function readMap(): IntentMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as IntentMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: IntentMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function getIntentForSession(sessionId: string | null): AnalyzeIntent {
  if (!sessionId) return { ...DEFAULT_ANALYZE_INTENT };
  const map = readMap();
  const stored = map[sessionId];
  if (!stored) return { ...DEFAULT_ANALYZE_INTENT };
  return { ...DEFAULT_ANALYZE_INTENT, ...stored };
}

export function setIntentForSession(sessionId: string, intent: AnalyzeIntent): void {
  const map = readMap();
  map[sessionId] = intent;
  writeMap(map);
}

/** Test-only */
export function clearIntentCacheForTests(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
