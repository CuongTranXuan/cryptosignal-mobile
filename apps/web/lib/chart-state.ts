/**
 * Per-session chart history wire contract (docs/CHART_HISTORY_SPEC.md):
 *   GET    /v1/copilot/sessions/{sid}/charts                     → index
 *   GET    /v1/copilot/sessions/{sid}/charts/{symbol}/{interval} → doc | 404 chart_state_not_found
 *   PUT    same path {shapes, markers?, analysis?, summary_text?, view?, revision?} → doc
 *          | 409 revision_conflict {current} | 413 chart_state_too_large {field, limit}
 *   DELETE same path
 */
import {
  CHART_HISTORY_DUPLICATE_ID,
  CHART_HISTORY_INVALID,
  CHART_HISTORY_INVALID_INTERVAL,
  CHART_HISTORY_INVALID_NUMBER,
  CHART_HISTORY_INVALID_VIEW,
  CHART_HISTORY_REQUEST_TOO_LARGE,
  chartHistoryTooLarge,
} from "./copilot-strings";
import { z } from "zod";
import { withCopilotCredentials } from "./copilot-fetch";
import { CopilotApiError, resolveCopilotBaseUrl, retryAfterHeaderMs, type ApiErrorBody } from "./copilot-api";
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

/** 413 envelope `{code, message (vi), field, limit: number}` (fixtures/wire/api_errors.json). */
export const ChartTooLargeBodySchema = z.object({
  code: z.enum(["chart_state_too_large", "request_too_large"]),
  message: z.string().nullable().optional(),
  field: z.string().nullable().optional(),
  limit: z.number().nullable().optional(),
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

/** Vietnamese name of each 413 `field` (docs/CHART_HISTORY_SPEC.md "Limits"). */
const TOO_LARGE_FIELD_VI: Record<string, string> = {
  body_bytes: "kích thước yêu cầu",
  shapes: "số hình",
  markers: "số điểm neo",
  points: "số điểm mỗi hình",
  string_bytes: "độ dài mỗi tên/nhãn",
  summary_text_bytes: "độ dài tóm tắt",
  analysis_bytes: "dữ liệu phân tích",
  doc_bytes: "kích thước biểu đồ",
  charts: "số biểu đồ mỗi phiên",
};

function hasVietnamese(text: string): boolean {
  return /[à-ỹÀ-ỸđĐ]/u.test(text);
}

const viNumber = (n: number): string => n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

/** "1,5 MB", "16 KB", "200" — `*_bytes` limits read as sizes. */
function formatTooLargeLimit(field: string, limit: number): string {
  if (!field.endsWith("_bytes")) return viNumber(limit);
  if (limit >= 1024 * 1024) return `${viNumber(limit / (1024 * 1024))} MB`;
  if (limit >= 1024) return `${viNumber(limit / 1024)} KB`;
  return `${viNumber(limit)} byte`;
}

/** "số hình 200" / "kích thước yêu cầu 1,5 MB"; "" when the cap is unknown. */
export function chartTooLargeLimitText(field: string | null | undefined, limit: number | null | undefined): string {
  if (!field || typeof limit !== "number" || !Number.isFinite(limit)) return "";
  return `${TOO_LARGE_FIELD_VI[field] ?? field} ${formatTooLargeLimit(field, limit)}`;
}

/**
 * The notice for a size cap, from a PUT 413 body or the analyze autosave meta
 * (`chart_state_error: chart_state_too_large` + `field` + `limit`): the server's Vietnamese
 * `message` plus the cap, else a client sentence built from `field` + `limit`.
 */
export function chartTooLargeText(info: {
  code?: string | null;
  message?: string | null;
  field?: string | null;
  limit?: number | null;
}): string {
  const cap = chartTooLargeLimitText(info.field, info.limit);
  const message = info.message?.trim().replace(/[.。]+$/u, "") ?? "";
  if (message && hasVietnamese(message)) {
    return `${message}${cap ? ` (giới hạn: ${cap})` : ""} — hình vẽ vẫn giữ trên thiết bị.`;
  }
  if (info.code === "request_too_large" && !cap) return CHART_HISTORY_REQUEST_TOO_LARGE;
  return chartHistoryTooLarge(cap);
}

/** Vietnamese notice for a 413 (`chart_state_too_large` or the raw-body `request_too_large`). */
export function chartTooLargeNotice(err: unknown): string | null {
  if (!(err instanceof CopilotApiError) || err.status !== 413) return null;
  const parsed = ChartTooLargeBodySchema.safeParse(err.body);
  if (!parsed.success) return chartHistoryTooLarge("");
  return chartTooLargeText(parsed.data);
}

const InvalidNumberDetailSchema = z.union([z.string(), z.number()]);
const InvalidViewDetailSchema = z.object({ from: z.unknown(), to: z.unknown() });
const DuplicateIdsDetailSchema = z.object({ ids: z.array(z.string()) });

/** Short "(…)" suffix from a 422 `detail`, or "". */
function invalidDetailSuffix(code: string | null, detail: unknown): string {
  if (code === "invalid_number") {
    const token = InvalidNumberDetailSchema.safeParse(detail);
    return token.success && String(token.data).trim() ? ` (${String(token.data).trim().slice(0, 32)})` : "";
  }
  if (code === "invalid_view_range") {
    const view = InvalidViewDetailSchema.safeParse(detail);
    return view.success ? ` (from ${String(view.data.from)} > to ${String(view.data.to)})` : "";
  }
  if (code === "duplicate_shape_id") {
    const dup = DuplicateIdsDetailSchema.safeParse(detail);
    if (!dup.success || dup.data.ids.length === 0) return "";
    const shown = dup.data.ids.slice(0, 3).join(", ");
    return ` (mã: ${shown}${dup.data.ids.length > 3 ? ", …" : ""})`;
  }
  return "";
}

/** Insert the detail before the " — hình vẽ vẫn giữ …" tail of a notice. */
function withDetail(notice: string, suffix: string): string {
  if (!suffix) return notice;
  const cut = notice.indexOf(" — ");
  return cut < 0 ? `${notice}${suffix}` : `${notice.slice(0, cut)}${suffix}${notice.slice(cut)}`;
}

/**
 * Vietnamese notice for a 422 on save. A chart PUT never answers 400 (non-JSON is
 * `invalid_chart_state`); a stray 400 lands on the generic notice.
 */
export function chartInvalidNotice(err: unknown): string {
  const code = err instanceof CopilotApiError ? err.code : null;
  const detail = err instanceof CopilotApiError ? err.body.detail : undefined;
  switch (code) {
    case "invalid_number":
      return withDetail(CHART_HISTORY_INVALID_NUMBER, invalidDetailSuffix(code, detail));
    case "invalid_view_range":
      return withDetail(CHART_HISTORY_INVALID_VIEW, invalidDetailSuffix(code, detail));
    case "duplicate_shape_id":
      return withDetail(CHART_HISTORY_DUPLICATE_ID, invalidDetailSuffix(code, detail));
    case "invalid_interval":
      return CHART_HISTORY_INVALID_INTERVAL;
    case "invalid_chart_state":
      return CHART_HISTORY_INVALID;
    default: {
      // Other codes (e.g. chart_key_mismatch): the server's Vietnamese message when it has one.
      const message = err instanceof CopilotApiError ? err.body.message?.trim() : "";
      return message && hasVietnamese(message)
        ? `Máy chủ từ chối biểu đồ: ${message.replace(/[.。]+$/u, "")} — hình vẽ vẫn giữ trên thiết bị.`
        : CHART_HISTORY_INVALID;
    }
  }
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function finiteShape(shape: PatternShape): PatternShape | null {
  if (!shape.points.every((p) => finite(p.time) && finite(p.price))) return null;
  if ((shape.priceLow != null && !finite(shape.priceLow)) || (shape.priceHigh != null && !finite(shape.priceHigh))) {
    return null;
  }
  const confidence = finite(shape.confidence) ? Math.min(1, Math.max(0, shape.confidence)) : 0;
  return confidence === shape.confidence ? shape : { ...shape, confidence };
}

function finiteMarker(marker: AgentMarker): AgentMarker | null {
  if (!finite(marker.time)) return null;
  const confidence = finite(marker.confidence) ? Math.min(1, Math.max(0, marker.confidence)) : 0;
  return confidence === marker.confidence ? marker : { ...marker, confidence };
}

/** Integer seconds with from <= to; null when either end is not a finite number. */
export function sanitizeChartView(view: ChartView | null | undefined): ChartView | null {
  if (!view || !finite(view.from) || !finite(view.to)) return null;
  const a = Math.floor(Math.min(view.from, view.to));
  const b = Math.ceil(Math.max(view.from, view.to));
  return { from: a, to: b };
}

/**
 * Head off the backend's 422s before a PUT: drop shapes/markers with NaN/±Inf numbers
 * (clamp confidence), keep the first shape per id, and send a well-formed view.
 */
export function sanitizeChartPutBody(body: ChartStatePutBody): ChartStatePutBody {
  const seen = new Set<string>();
  const shapes: PatternShape[] = [];
  for (const raw of body.shapes) {
    if (seen.has(raw.id)) continue;
    const shape = finiteShape(raw);
    if (!shape) continue;
    seen.add(shape.id);
    shapes.push(shape);
  }
  const out: ChartStatePutBody = { ...body, shapes };
  if (body.markers) {
    const markerIds = new Set<string>();
    out.markers = body.markers.flatMap((m) => {
      const marker = finiteMarker(m);
      if (!marker || markerIds.has(marker.id)) return [];
      markerIds.add(marker.id);
      return [marker];
    });
  }
  if (body.view !== undefined) {
    const view = sanitizeChartView(body.view);
    if (view) out.view = view;
    else delete out.view;
  }
  return out;
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

async function chartApiError(res: Response, fallback: string): Promise<CopilotApiError> {
  return new CopilotApiError(res.status, await readBody(res), fallback, retryAfterHeaderMs(res.headers.get("Retry-After")));
}

async function okJson(res: Response, fallback: string): Promise<unknown> {
  if (!res.ok) throw await chartApiError(res, fallback);
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
  opts: { fetchImpl?: typeof fetch; baseUrl?: string; forceMock?: boolean } = {},
): ChartStateApi {
  if (opts.forceMock) return createMockChartStateApi();
  const fetchImpl = withCopilotCredentials(opts.fetchImpl ?? fetch);
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
        throw await chartApiError(res, "chart_delete_failed");
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
