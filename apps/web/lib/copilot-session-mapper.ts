import type { CopilotModelRecord } from "./copilot-schema";
import type { CopilotSessionApi, CopilotSessionV1, SessionSummary } from "./copilot-schema";
import { modelLabelForSession } from "./copilot-model-defaults";
import {
  chartForApi,
  decodeSessionTitle,
  encodeSessionTitle,
  messagesForApi,
  sessionFingerprint,
  stripReasoningFromTitle,
} from "./copilot-session-encoding";
import type { AgentMarker, PatternShape } from "./pattern-shape";

export function apiSessionToClient(api: CopilotSessionApi): CopilotSessionV1 {
  const { title, reasoning_effort } = decodeSessionTitle(api.title);
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
      markers: undefined,
    })),
  };
}

export function clientSessionToCreateBody(session: CopilotSessionV1): {
  title: string;
  model_id: string;
  chart: CopilotSessionV1["chart"];
  messages: ReturnType<typeof messagesForApi>;
} {
  return {
    title: encodeSessionTitle(session.title, session.reasoning_effort ?? null),
    model_id: session.model_id,
    chart: chartForApi(session.chart),
    messages: messagesForApi(session.messages),
  };
}

export function clientSessionToUpdateBody(session: CopilotSessionV1): {
  title: string;
  model_id: string;
  chart: CopilotSessionV1["chart"];
  messages: ReturnType<typeof messagesForApi>;
} {
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
    title: stripReasoningFromTitle(summary.title),
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
  const { title } = decodeSessionTitle(api.title);
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
  return `${summary.created_at}:${stripReasoningFromTitle(summary.title)}:${summary.message_count}`;
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
