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
  // Device identity: the backend's httpOnly `csm_device` cookie must reach it.
  "cookie",
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

/** Every upstream `Set-Cookie`, one entry per cookie (never comma-joined). */
export function upstreamSetCookies(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  const joined = headers.get("set-cookie");
  return joined ? [joined] : [];
}

export function stripHopByHopResponseHeaders(headers: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_REQUEST_HEADERS.has(lower) || lower === "set-cookie") continue;
    out.set(key, value);
  }
  for (const cookie of upstreamSetCookies(headers)) out.append("set-cookie", cookie);
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
