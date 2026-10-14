export const COPILOT_PROXY_PATH_PREFIX = "/v1/copilot";

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "content-length",
  "if-none-match",
  "if-modified-since",
  "cache-control",
];

export type CopilotProxyErrorBody = {
  code: string;
  message: string;
  detail: unknown;
};

export function readCopilotUpstreamUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.COPILOT_UPSTREAM_URL;
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
}

export function buildCopilotUpstreamUrl(
  upstreamBase: string,
  pathSegments: string[],
  searchParams: string,
): string {
  const base = upstreamBase.replace(/\/$/, "");
  const suffix = pathSegments.map((s) => encodeURIComponent(s)).join("/");
  const path = `${COPILOT_PROXY_PATH_PREFIX}/${suffix}`;
  const qs = searchParams && searchParams.startsWith("?") ? searchParams : searchParams ? `?${searchParams}` : "";
  return `${base}${path}${qs}`;
}

export function pickForwardRequestHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

export function stripHopByHopResponseHeaders(headers: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of headers.entries()) {
    if (HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    out.set(key, value);
  }
  out.set("X-Accel-Buffering", "no");
  out.set("Cache-Control", "no-cache");
  return out;
}

export function copilotUpstreamMissingResponse(): Response {
  const body: CopilotProxyErrorBody = {
    code: "copilot_upstream_unconfigured",
    message: "Copilot upstream is not configured (set COPILOT_UPSTREAM_URL).",
    detail: null,
  };
  return Response.json(body, { status: 503 });
}

export type CopilotProxyOptions = {
  pathSegments: string[];
  fetchImpl?: typeof fetch;
  getUpstreamUrl?: () => string | null;
};

export async function proxyCopilotRequest(
  request: Request,
  opts: CopilotProxyOptions,
): Promise<Response> {
  const upstreamBase = opts.getUpstreamUrl?.() ?? readCopilotUpstreamUrl();
  if (!upstreamBase) {
    return copilotUpstreamMissingResponse();
  }

  const url = new URL(request.url);
  const target = buildCopilotUpstreamUrl(upstreamBase, opts.pathSegments, url.search);

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: pickForwardRequestHeaders(request.headers),
    signal: request.signal,
  };

  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const upstream = await fetchImpl(target, init);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: stripHopByHopResponseHeaders(upstream.headers),
  });
}
