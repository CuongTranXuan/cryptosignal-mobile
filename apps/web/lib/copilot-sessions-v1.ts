import { z } from "zod";
import { DEFAULT_CANDLE_COUNT } from "./copilot-model-limits";
import { CopilotSessionSchema, type CopilotSessionV1 } from "./copilot-schema";
import type { AgentMarker, PatternShape } from "./pattern-shape";

export const SESSIONS_STORAGE_KEY = "copilot.sessions.v1";
const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 200;

const SessionsBlobSchema = z.object({
  active_session_id: z.string().nullable(),
  sessions: z.array(CopilotSessionSchema),
});

export type SessionsBlob = z.infer<typeof SessionsBlobSchema>;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function readBlob(): SessionsBlob {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) {
      return { active_session_id: null, sessions: [] };
    }
    return SessionsBlobSchema.parse(JSON.parse(raw));
  } catch {
    return { active_session_id: null, sessions: [] };
  }
}

function writeBlob(blob: SessionsBlob): void {
  localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(blob));
}

function evictSessions(sessions: CopilotSessionV1[]): CopilotSessionV1[] {
  const sorted = [...sessions].sort((a, b) => b.updated_at - a.updated_at);
  return sorted.slice(0, MAX_SESSIONS);
}

function trimMessages(session: CopilotSessionV1): CopilotSessionV1 {
  if (session.messages.length <= MAX_MESSAGES_PER_SESSION) return session;
  return {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
  };
}

export function loadSessionsBlob(): SessionsBlob {
  const blob = readBlob();
  return {
    active_session_id: blob.active_session_id,
    sessions: evictSessions(blob.sessions.map(trimMessages)),
  };
}

export function saveSessionsBlob(blob: SessionsBlob): void {
  writeBlob({
    active_session_id: blob.active_session_id,
    sessions: evictSessions(blob.sessions.map(trimMessages)),
  });
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `sess_${crypto.randomUUID()}`;
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptySession(
  modelId: string,
  title = "Phiên mới",
  reasoningEffort: string | null = null,
): CopilotSessionV1 {
  const t = nowSec();
  return {
    id: newSessionId(),
    title,
    created_at: t,
    updated_at: t,
    model_id: modelId,
    reasoning_effort: reasoningEffort,
    chart: {
      symbol: "BTCUSDT",
      interval: "1h",
      from: 0,
      to: 0,
      candle_count: DEFAULT_CANDLE_COUNT,
    },
    messages: [],
  };
}

export function sessionSummary(session: CopilotSessionV1) {
  return {
    id: session.id,
    title: session.title,
    updated_at: session.updated_at,
    model_id: session.model_id,
  };
}

export function shapesFromSessionMessages(session: CopilotSessionV1): PatternShape[] {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg?.role === "assistant" && msg.shapes.length > 0) {
      return msg.shapes as PatternShape[];
    }
  }
  return [];
}

export function markersFromSessionMessages(session: CopilotSessionV1): AgentMarker[] {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg?.role === "assistant" && msg.markers && msg.markers.length > 0) {
      return msg.markers as AgentMarker[];
    }
  }
  return [];
}
