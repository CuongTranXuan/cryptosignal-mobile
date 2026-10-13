import type { CopilotModelRecord } from "./copilot-schema";
import type {
  CopilotSessionApi,
  CopilotSessionV1,
  CreateSessionRequest,
  SessionSummary,
  UpdateSessionRequest,
} from "./copilot-schema";
import { modelLabelForSession } from "./copilot-model-defaults";
import {
  decodeLegacySessionTitle,
  stripLegacyReasoningFromTitle,
  titleHasLegacyReasoningEncoding,
} from "./copilot-session-legacy-title";
import { chartForApi, messagesForApi, sessionFingerprint } from "./copilot-session-wire";
import type { AgentMarker, PatternShape } from "./pattern-shape";

function resolveTitleAndReasoning(api: CopilotSessionApi): {
  title: string;
  reasoning_effort: string | null;
} {
  if (titleHasLegacyReasoningEncoding(api.title)) {
    const decoded = decodeLegacySessionTitle(api.title);
    return {
      title: decoded.title,
      reasoning_effort: api.reasoning_effort ?? decoded.reasoning_effort,
    };
  }
  return {
    title: api.title,
    reasoning_effort: api.reasoning_effort ?? null,
  };
}

export function apiSessionToClient(api: CopilotSessionApi): CopilotSessionV1 {
  const { title, reasoning_effort } = resolveTitleAndReasoning(api);
  return {
    id: api.id,
    title,
    created_at: api.created_at,
    updated_at: api.updated_at,
    model_id: api.model_id,
    reasoning_effort,
    chart: api.chart,
    messages: api.messages.map((m) => ({
      ...m,
      shapes: (m.shapes ?? []) as PatternShape[],
      markers: (m.markers ?? []) as AgentMarker[],
    })),
  };
}

export function clientSessionToCreateBody(session: CopilotSessionV1): CreateSessionRequest {
  return {
    title: session.title,
    model_id: session.model_id,
    reasoning_effort: session.reasoning_effort ?? null,
    chart: chartForApi(session.chart),
    messages: messagesForApi(session.messages),
  };
}

export function clientSessionToUpdateBody(session: CopilotSessionV1): UpdateSessionRequest {
  return clientSessionToCreateBody(session);
}

export function summaryFromApi(summary: SessionSummary): {
  id: string;
  title: string;
  updated_at: number;
  model_id: string;
} {
  return {
    id: summary.id,
    title: stripLegacyReasoningFromTitle(summary.title),
    updated_at: summary.updated_at,
    model_id: summary.model_id,
  };
}

export function summaryFromApiSession(api: CopilotSessionApi): {
  id: string;
  title: string;
  updated_at: number;
  model_id: string;
} {
  const { title } = resolveTitleAndReasoning(api);
  return {
    id: api.id,
    title,
    updated_at: api.updated_at,
    model_id: api.model_id,
  };
}

export function summaryFromClientSession(session: CopilotSessionV1): {
  id: string;
  title: string;
  updated_at: number;
  model_id: string;
} {
  return {
    id: session.id,
    title: session.title,
    updated_at: session.updated_at,
    model_id: session.model_id,
  };
}

export function summaryFingerprintFromApi(summary: SessionSummary): string {
  return `${summary.created_at}:${stripLegacyReasoningFromTitle(summary.title)}:${summary.message_count}`;
}

export function agentMessageModelLabel(
  models: CopilotModelRecord[],
  modelId: string | null | undefined,
  apiDefaultId: string | null | undefined,
): string | undefined {
  if (!modelId?.trim()) return undefined;
  return modelLabelForSession(models, modelId, apiDefaultId);
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

export { sessionFingerprint };
