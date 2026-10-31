import type { CopilotSessionV1 } from "./copilot-schema";
import type { AgentMarker } from "./pattern-shape";

export function sessionFingerprint(session: {
  title: string;
  created_at: number;
  messages: { length: number };
}): string {
  return `${session.created_at}:${session.title}:${session.messages.length}`;
}

export type ApiSessionMessage = CopilotSessionV1["messages"][number];

export function messagesForApi(messages: ApiSessionMessage[]): ApiSessionMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    model_id: m.model_id,
    shapes: m.shapes ?? [],
    markers: (m.markers ?? []) as AgentMarker[],
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
