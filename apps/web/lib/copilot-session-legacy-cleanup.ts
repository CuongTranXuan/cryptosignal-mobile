import type { CopilotApiClient } from "./copilot-api";
import type { CopilotSessionApi } from "./copilot-schema";
import {
  decodeLegacySessionTitle,
  titleHasLegacyReasoningEncoding,
} from "./copilot-session-legacy-title";

/**
 * One-time repair for sessions saved while reasoning lived in `title`.
 * Idempotent: no-op when title is already clean.
 */
export async function repairLegacyEncodedSessionTitle(
  api: CopilotApiClient,
  session: CopilotSessionApi,
): Promise<CopilotSessionApi> {
  if (!titleHasLegacyReasoningEncoding(session.title)) {
    return session;
  }
  const decoded = decodeLegacySessionTitle(session.title);
  const reasoning_effort = session.reasoning_effort ?? decoded.reasoning_effort;
  return api.updateSession(session.id, {
    title: decoded.title,
    reasoning_effort,
  });
}

export async function repairLegacyEncodedSessions(
  api: CopilotApiClient,
  sessions: CopilotSessionApi[],
): Promise<CopilotSessionApi[]> {
  const out: CopilotSessionApi[] = [];
  for (const session of sessions) {
    out.push(await repairLegacyEncodedSessionTitle(api, session));
  }
  return out;
}
