import { z } from "zod";
import type { CopilotApiClient } from "./copilot-api";
import { CopilotSessionSchema, type CopilotSessionV1, type SessionSummary } from "./copilot-schema";
import {
  clientSessionToCreateBody,
  summaryFingerprintFromApi,
} from "./copilot-session-mapper";
import { sessionFingerprint } from "./copilot-session-encoding";

/** Legacy localStorage blob (removed after successful migration). */
export const LEGACY_SESSIONS_STORAGE_KEY = "copilot.sessions.v1";

const MigrationStateSchema = z.object({
  version: z.literal(1),
  /** local session id -> server session id */
  id_map: z.record(z.string()),
  /** fingerprints already present on server */
  server_fingerprints: z.array(z.string()).optional(),
});

export type MigrationState = z.infer<typeof MigrationStateSchema>;

const MIGRATION_STATE_KEY = "copilot.sessions.migration.v1";

const LegacyBlobSchema = z.object({
  active_session_id: z.string().nullable(),
  sessions: z.array(CopilotSessionSchema),
});

export type LegacySessionsBlob = z.infer<typeof LegacyBlobSchema>;

export function loadLegacySessionsBlob(): LegacySessionsBlob {
  try {
    const raw = localStorage.getItem(LEGACY_SESSIONS_STORAGE_KEY);
    if (!raw) return { active_session_id: null, sessions: [] };
    return LegacyBlobSchema.parse(JSON.parse(raw));
  } catch {
    return { active_session_id: null, sessions: [] };
  }
}

export function saveLegacySessionsBlob(blob: LegacySessionsBlob): void {
  localStorage.setItem(LEGACY_SESSIONS_STORAGE_KEY, JSON.stringify(blob));
}

export function clearLegacySessionsBlob(): void {
  localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY);
}

function loadMigrationState(): MigrationState {
  try {
    const raw = localStorage.getItem(MIGRATION_STATE_KEY);
    if (!raw) return { version: 1, id_map: {} };
    return MigrationStateSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1, id_map: {} };
  }
}

function saveMigrationState(state: MigrationState): void {
  localStorage.setItem(MIGRATION_STATE_KEY, JSON.stringify(state));
}

function buildServerFingerprintSet(summaries: SessionSummary[]): Set<string> {
  const set = new Set<string>();
  for (const s of summaries) {
    set.add(summaryFingerprintFromApi(s));
  }
  const state = loadMigrationState();
  for (const fp of state.server_fingerprints ?? []) {
    set.add(fp);
  }
  return set;
}

export type MigrationResult = {
  migratedActiveId: string | null;
  serverFingerprints: Set<string>;
  failures: { localId: string; message: string }[];
};

/**
 * Idempotent: skips locals already in id_map or matching a server fingerprint.
 * Removes each local row only after create succeeds.
 */
export async function migrateLegacySessionsIfNeeded(
  api: CopilotApiClient,
  serverSummaries: SessionSummary[],
): Promise<MigrationResult> {
  const blob = loadLegacySessionsBlob();
  if (blob.sessions.length === 0) {
    return { migratedActiveId: null, serverFingerprints: buildServerFingerprintSet(serverSummaries), failures: [] };
  }

  const state = loadMigrationState();
  const serverFp = buildServerFingerprintSet(serverSummaries);
  const failures: { localId: string; message: string }[] = [];
  let nextActive: string | null = null;

  if (blob.active_session_id && state.id_map[blob.active_session_id]) {
    nextActive = state.id_map[blob.active_session_id] ?? null;
  }

  const remaining: CopilotSessionV1[] = [];

  for (const local of blob.sessions) {
    const mappedId = state.id_map[local.id];
    if (mappedId) {
      serverFp.add(sessionFingerprint(local));
      if (blob.active_session_id === local.id) {
        nextActive = mappedId;
      }
      continue;
    }

    const fp = sessionFingerprint(local);
    if (serverFp.has(fp)) {
      const match = serverSummaries.find((s) => summaryFingerprintFromApi(s) === fp);
      if (match) {
        state.id_map[local.id] = match.id;
        if (blob.active_session_id === local.id) {
          nextActive = match.id;
        }
        continue;
      }
    }

    try {
      const body = clientSessionToCreateBody(local);
      const created = await api.createSession(body);
      state.id_map[local.id] = created.id;
      serverFp.add(fp);
      if (blob.active_session_id === local.id) {
        nextActive = created.id;
      }
    } catch (err) {
      failures.push({
        localId: local.id,
        message: err instanceof Error ? err.message : "migration_failed",
      });
      remaining.push(local);
    }
  }

  state.server_fingerprints = [...serverFp];
  saveMigrationState(state);

  if (remaining.length === 0) {
    clearLegacySessionsBlob();
  } else {
    saveLegacySessionsBlob({
      active_session_id: blob.active_session_id,
      sessions: remaining,
    });
  }

  return { migratedActiveId: nextActive, serverFingerprints: serverFp, failures };
}
