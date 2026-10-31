import type { CopilotApiClient } from "./copilot-api";
import { AnalyzeIntentSchema } from "./copilot-schema";

const LEGACY_STORAGE_KEY = "copilot.chart_intent.v1";

type LegacyIntentMap = Record<string, unknown>;

function readLegacyMap(): LegacyIntentMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LegacyIntentMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLegacyMap(map: LegacyIntentMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

/** One-time idempotent migration from pre-session-intent localStorage to PATCH. */
export async function migrateLegacyChartIntentLocalStorage(
  api: CopilotApiClient,
): Promise<void> {
  const map = readLegacyMap();
  const sessionIds = Object.keys(map);
  if (sessionIds.length === 0) return;

  for (const sessionId of sessionIds) {
    const parsed = AnalyzeIntentSchema.safeParse(map[sessionId]);
    if (!parsed.success) {
      delete map[sessionId];
      writeLegacyMap(map);
      continue;
    }
    try {
      await api.updateSession(sessionId, { intent: parsed.data });
      delete map[sessionId];
      writeLegacyMap(map);
    } catch {
      // Keep entry until a later bootstrap can retry.
    }
  }
}

export function clearLegacyChartIntentStorageForTests(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}
