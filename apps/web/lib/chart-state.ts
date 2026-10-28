/**
 * Per-session chart history wire contract (docs/CHART_HISTORY_SPEC.md):
 *   GET    /v1/copilot/sessions/{sid}/charts                     → index
 *   GET    /v1/copilot/sessions/{sid}/charts/{symbol}/{interval} → doc | 404 chart_state_not_found
 *   PUT    same path {shapes, markers?, analysis?, summary_text?, view?, revision?} → doc
 *          | 409 revision_conflict {current} | 413 chart_state_too_large {limit}
 *   DELETE same path
 */
import { z } from "zod";
import { copilotAuthHeaders } from "./copilot-auth";
import { CopilotApiError, resolveCopilotBaseUrl, type ApiErrorBody } from "./copilot-api";
import { coerceAgentMarker, coerceAgentShape } from "./normalize-agent-shape";
import {
  AgentMarkerSchema,
  INTERVALS,
  PatternShapeSchema,
  type AgentMarker,
  type Interval,
  type PatternShape,
} from "./pattern-shape";

export const ChartViewSchema = z.object({ from: z.number().int(), to: z.number().int() });
export type ChartView = z.infer<typeof ChartViewSchema>;

export const ChartIndexEntrySchema = z.object({
  symbol: z.string().min(1),
  interval: z.enum(INTERVALS),
  updated_at: z.number(),
  revision: z.number().int(),
  analyzed_at: z.number().nullable(),
  shape_count: z.number().int().nonnegative(),
  has_analysis: z.boolean(),
});
export type ChartIndexEntry = z.infer<typeof ChartIndexEntrySchema>;

export const ChartIndexResponseSchema = z.object({ charts: z.array(ChartIndexEntrySchema) });
export type ChartIndexResponse = z.infer<typeof ChartIndexResponseSchema>;

/** Shapes/markers stay `unknown` here; {@link normalizeChartDoc} validates them one by one. */
export const ChartStateDocWireSchema = z.object({
  symbol: z.string().min(1),
  interval: z.enum(INTERVALS),
  revision: z.number().int(),
  updated_at: z.number(),
  shapes: z.array(z.unknown()),
  markers: z.array(z.unknown()).optional().default([]),
  analysis: z.record(z.string(), z.unknown()).nullable().optional().default(null),
  summary_text: z.string().nullable().optional().default(null),
  model: z.string().nullable().optional().default(null),
  analyzed_at: z.number().nullable().optional().default(null),
  view: ChartViewSchema.nullable().optional().default(null),
  chart_state_revision: z.number().int().optional(),
});
export type ChartStateDocWire = z.infer<typeof ChartStateDocWireSchema>;

export type ChartStateDoc = Omit<ChartStateDocWire, "shapes" | "markers" | "interval"> & {
  interval: Interval;
  shapes: PatternShape[];
  markers: AgentMarker[];
};

export const ChartConflictBodySchema = z.object({
  code: z.literal("revision_conflict"),
  current: ChartStateDocWireSchema,
});

export const ChartTooLargeBodySchema = z.object({
  code: z.literal("chart_state_too_large"),
  limit: z.unknown().optional(),
});

export type ChartStatePutBody = {
  shapes: PatternShape[];
  markers?: AgentMarker[];
  analysis?: Record<string, unknown> | null;
  summary_text?: string | null;
  view?: ChartView | null;
  revision?: number;
};

export function chartKey(sessionId: string, symbol: string, interval: Interval): string {
  return `${sessionId}|${symbol.toUpperCase()}|${interval}`;
}

const OPTIONAL_SHAPE_KEYS = ["agentId", "guardrail", "origin", "kept", "edited", "drawing_id"];
const OPTIONAL_MARKER_KEYS = ["agentId", "label", "drawing_id", "guardrail"];

/** Python dumps unset optionals as null; the web schemas use `.optional()`. */
function dropNullKeys(raw: unknown, keys: readonly string[]): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of keys) if (out[key] === null) delete out[key];
  return out;
}

/** Validate saved shapes/markers the same way SSE overlays are validated; drop bad rows. */
export function normalizeChartDoc(wire: ChartStateDocWire): ChartStateDoc {
  const ctx = { symbol: wire.symbol.toUpperCase(), interval: wire.interval };
  const shapes: PatternShape[] = [];
  for (const raw of wire.shapes) {
    const coerced = coerceAgentShape(dropNullKeys(raw, OPTIONAL_SHAPE_KEYS), ctx);
    if (coerced && typeof coerced === "object") {
      const row = coerced as Record<string, unknown>;
      // Saved shapes are already on the chart: committed, never preview.
      row.status = "committed";
      if (row.origin === "user" && row.source == null) row.source = "human";
    }
    const parsed = PatternShapeSchema.safeParse(coerced);
    if (parsed.success) shapes.push(parsed.data);
  }
  const markers: AgentMarker[] = [];
  for (const raw of wire.markers) {
    const parsed = AgentMarkerSchema.safeParse(
      coerceAgentMarker(dropNullKeys(raw, OPTIONAL_MARKER_KEYS), ctx),
    );
    if (parsed.success) markers.push(parsed.data);
  }
  return { ...wire, symbol: ctx.symbol, shapes, markers };
}

export function parseChartStateDoc(json: unknown): ChartStateDoc {
  return normalizeChartDoc(ChartStateDocWireSchema.parse(json));
}

export function isChartStateNotFound(err: unknown): boolean {
  return err instanceof CopilotApiError && err.status === 404 && err.code === "chart_state_not_found";
}

export function chartConflictCurrent(err: unknown): ChartStateDoc | null {
  if (!(err instanceof CopilotApiError) || err.status !== 409) return null;
  const parsed = ChartConflictBodySchema.safeParse(err.body);
  return parsed.success ? normalizeChartDoc(parsed.data.current) : null;
}

export function chartTooLargeLimit(err: unknown): string | null {
  if (!(err instanceof CopilotApiError) || err.status !== 413) return null;
  const parsed = ChartTooLargeBodySchema.safeParse(err.body);
  const limit = parsed.success ? parsed.data.limit : undefined;
  if (limit == null) return "";
  if (typeof limit === "object") {
    return Object.entries(limit as Record<string, unknown>)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(", ");
  }
  return String(limit);
}

export type ChartStateApi = {
  listCharts: (sessionId: string) => Promise<ChartIndexResponse>;
  getChart: (sessionId: string, symbol: string, interval: Interval) => Promise<ChartStateDoc>;
  putChart: (
    sessionId: string,
    symbol: string,
    interval: Interval,
    body: ChartStatePutBody,
  ) => Promise<ChartStateDoc>;
  deleteChart: (sessionId: string, symbol: string, interval: Interval) => Promise<void>;
};

async function readBody(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

async function okJson(res: Response, fallback: string): Promise<unknown> {
  if (!res.ok) throw new CopilotApiError(res.status, await readBody(res), fallback);
  return res.json();
}

function chartPath(baseUrl: string, sessionId: string, symbol: string, interval: Interval): string {
  return `${baseUrl}/v1/copilot/sessions/${encodeURIComponent(sessionId)}/charts/${encodeURIComponent(
    symbol.toUpperCase(),
  )}/${encodeURIComponent(interval)}`;
}

/** Strip client-only fields; keep the chart-history flags the backend stores. */
export function shapeForChartState(shape: PatternShape): PatternShape {
  return { ...shape, status: "committed" };
}

export function createChartStateApi(
  opts: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    forceMock?: boolean;
    /** Extra headers per request (device token); defaults to `copilotAuthHeaders`. */
    authHeaders?: () => Record<string, string>;
  } = {},
): ChartStateApi {
  if (opts.forceMock) return createMockChartStateApi();
  const rawFetch = opts.fetchImpl ?? fetch;
  const authHeaders = opts.authHeaders ?? copilotAuthHeaders;
  const fetchImpl = (url: string, init: RequestInit = {}) =>
    rawFetch(url, { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string>) } });
  const baseUrl = resolveCopilotBaseUrl(opts.baseUrl);
  return {
    listCharts: async (sessionId) =>
      ChartIndexResponseSchema.parse(
        await okJson(
          await fetchImpl(`${baseUrl}/v1/copilot/sessions/${encodeURIComponent(sessionId)}/charts`),
          "chart_index_failed",
        ),
      ),
    getChart: async (sessionId, symbol, interval) =>
      parseChartStateDoc(
        await okJson(await fetchImpl(chartPath(baseUrl, sessionId, symbol, interval)), "chart_get_failed"),
      ),
    putChart: async (sessionId, symbol, interval, body) =>
      parseChartStateDoc(
        await okJson(
          await fetchImpl(chartPath(baseUrl, sessionId, symbol, interval), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, shapes: body.shapes.map(shapeForChartState) }),
          }),
          "chart_put_failed",
        ),
      ),
    deleteChart: async (sessionId, symbol, interval) => {
      const res = await fetchImpl(chartPath(baseUrl, sessionId, symbol, interval), { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new CopilotApiError(res.status, await readBody(res), "chart_delete_failed");
      }
    },
  };
}

/** In-memory implementation of the contract (offline/mock mode and tests). */
export function createMockChartStateApi(): ChartStateApi {
  const docs = new Map<string, ChartStateDocWire>();
  const notFound = () =>
    new CopilotApiError(404, { code: "chart_state_not_found" }, "chart_state_not_found");
  return {
    listCharts: async (sessionId) => {
      const charts = [...docs.entries()]
        .filter(([k]) => k.startsWith(`${sessionId}|`))
        .map(([, d]) => ({
          symbol: d.symbol,
          interval: d.interval,
          updated_at: d.updated_at,
          revision: d.revision,
          analyzed_at: d.analyzed_at,
          shape_count: d.shapes.length,
          has_analysis: d.analysis != null,
        }))
        .sort((a, b) => b.updated_at - a.updated_at);
      return { charts };
    },
    getChart: async (sessionId, symbol, interval) => {
      const doc = docs.get(chartKey(sessionId, symbol, interval));
      if (!doc) throw notFound();
      return normalizeChartDoc(doc);
    },
    putChart: async (sessionId, symbol, interval, body) => {
      const key = chartKey(sessionId, symbol, interval);
      const current = docs.get(key);
      if ((current && body.revision !== current.revision) || (!current && body.revision != null)) {
        if (!current) throw notFound();
        throw new CopilotApiError(409, { code: "revision_conflict", current } as ApiErrorBody, "revision_conflict");
      }
      const revision = (current?.revision ?? 0) + 1;
      const doc: ChartStateDocWire = {
        symbol: symbol.toUpperCase(),
        interval,
        revision,
        updated_at: Date.now() / 1000,
        shapes: body.shapes.map(shapeForChartState),
        markers: body.markers ?? current?.markers ?? [],
        analysis: body.analysis !== undefined ? body.analysis : (current?.analysis ?? null),
        summary_text:
          body.summary_text !== undefined ? body.summary_text : (current?.summary_text ?? null),
        model: current?.model ?? null,
        analyzed_at: current?.analyzed_at ?? null,
        view: body.view !== undefined ? body.view : (current?.view ?? null),
        chart_state_revision: revision,
      };
      docs.set(key, doc);
      return normalizeChartDoc(doc);
    },
    deleteChart: async (sessionId, symbol, interval) => {
      docs.delete(chartKey(sessionId, symbol, interval));
    },
  };
}
