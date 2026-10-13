import type { CopilotSessionV1 } from "./copilot-schema";

/** Non-visible separator: encodes session reasoning in `title` until backend has a field. */
export const SESSION_REASONING_TITLE_SEP = "\u001e";

export function stripReasoningFromTitle(encoded: string): string {
  const idx = encoded.indexOf(SESSION_REASONING_TITLE_SEP);
  if (idx < 0) return encoded;
  return encoded.slice(0, idx);
}

export function decodeSessionTitle(encoded: string): {
  title: string;
  reasoning_effort: string | null;
} {
  const idx = encoded.indexOf(SESSION_REASONING_TITLE_SEP);
  if (idx < 0) {
    return { title: encoded, reasoning_effort: null };
  }
  const title = encoded.slice(0, idx);
  const effort = encoded.slice(idx + SESSION_REASONING_TITLE_SEP.length).trim();
  return { title, reasoning_effort: effort || null };
}

export function encodeSessionTitle(title: string, reasoningEffort: string | null): string {
  const display = stripReasoningFromTitle(title);
  if (!reasoningEffort) return display;
  return `${display}${SESSION_REASONING_TITLE_SEP}${reasoningEffort}`;
}

export function sessionFingerprint(session: {
  title: string;
  created_at: number;
  messages: { length: number };
}): string {
  const displayTitle = stripReasoningFromTitle(session.title);
  return `${session.created_at}:${displayTitle}:${session.messages.length}`;
}

export type ApiSessionMessage = CopilotSessionV1["messages"][number];

/** Backend `SessionMessage` has no `markers`; omit before wire. */
export function messagesForApi(messages: ApiSessionMessage[]): Omit<ApiSessionMessage, "markers">[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    model_id: m.model_id,
    shapes: m.shapes ?? [],
    created_at: m.created_at,
    meta: m.meta,
  }));
}

export function chartForApi(chart: CopilotSessionV1["chart"]): CopilotSessionV1["chart"] {
  return {
    symbol: chart.symbol,
    interval: chart.interval,
    from: chart.from,
    to: chart.to,
    candle_count: chart.candle_count,
  };
}
