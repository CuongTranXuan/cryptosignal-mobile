import { describe, expect, it, vi } from "vitest";
import {
  buildCopilotUpstreamUrl,
  copilotUpstreamMissingResponse,
  proxyCopilotRequest,
  readCopilotUpstreamUrl,
} from "../lib/server/copilot-proxy";

describe("copilot-proxy", () => {
  it("buildCopilotUpstreamUrl forwards path and query", () => {
    const url = buildCopilotUpstreamUrl("http://copilot:8000", ["sessions", "abc"], "?q=1");
    expect(url).toBe("http://copilot:8000/v1/copilot/sessions/abc?q=1");
  });

  it("readCopilotUpstreamUrl trims and rejects empty", () => {
    expect(readCopilotUpstreamUrl({ COPILOT_UPSTREAM_URL: " http://x/ " })).toBe("http://x");
    expect(readCopilotUpstreamUrl({ COPILOT_UPSTREAM_URL: "" })).toBeNull();
    expect(readCopilotUpstreamUrl({})).toBeNull();
  });

  it("returns 503 JSON when upstream env is missing", async () => {
    const res = await proxyCopilotRequest(new Request("http://localhost/v1/copilot/health"), {
      pathSegments: ["health"],
      getUpstreamUrl: () => null,
    });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code: string; message: string };
    expect(json.code).toBe("copilot_upstream_unconfigured");
    expect(json.message).toMatch(/COPILOT_UPSTREAM_URL/);
    expect(copilotUpstreamMissingResponse().status).toBe(503);
  });

  it("streams SSE body chunk by chunk and forwards abort signal", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: meta\n"));
        controller.enqueue(encoder.encode("data: {}\n\n"));
        controller.close();
      },
    });

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const controller = new AbortController();
    const req = new Request("http://localhost/v1/copilot/analyze?q=1", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    });

    const res = await proxyCopilotRequest(req, {
      pathSegments: ["analyze"],
      fetchImpl: fetchImpl as typeof fetch,
      getUpstreamUrl: () => "http://upstream:8000",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://upstream:8000/v1/copilot/analyze?q=1",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");

    const reader = res.body!.getReader();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    expect(chunks.join("")).toBe("event: meta\ndata: {}\n\n");
  });

  describe("csm_device cookie forwarding", () => {
    const cookieA = "csm_device=v1.abc.sig; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000";
    const cookieB = "other=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT";

    async function roundTrip(method: string, path: string[], body?: string, accept = "application/json") {
      const seen: { headers?: Headers } = {};
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        seen.headers = new Headers(init?.headers);
        const headers = new Headers({ "Content-Type": accept === "text/event-stream" ? accept : "application/json" });
        headers.append("Set-Cookie", cookieA);
        headers.append("Set-Cookie", cookieB);
        return new Response(accept === "text/event-stream" ? "event: done\ndata: {}\n\n" : "{}", {
          status: 200,
          headers,
        });
      });
      const req = new Request(`http://localhost/v1/copilot/${path.join("/")}`, {
        method,
        body,
        headers: { Cookie: "csm_device=v1.abc.sig; theme=dark", Accept: accept, "Content-Type": "application/json" },
      });
      const res = await proxyCopilotRequest(req, {
        pathSegments: path,
        fetchImpl: fetchImpl as typeof fetch,
        getUpstreamUrl: () => "http://upstream:8000",
      });
      return { res, upstreamHeaders: seen.headers! };
    }

    it.each([
      ["GET", ["sessions", "s1"], undefined, "application/json"],
      ["PUT", ["sessions", "s1", "charts", "BTCUSDT", "1h"], "{}", "application/json"],
      ["POST", ["analyze"], "{}", "text/event-stream"],
    ] as const)("%s %s: request Cookie goes upstream; each Set-Cookie comes back separately", async (method, path, body, accept) => {
      const { res, upstreamHeaders } = await roundTrip(method, [...path], body, accept);
      expect(upstreamHeaders.get("cookie")).toBe("csm_device=v1.abc.sig; theme=dark");
      expect(res.headers.getSetCookie()).toEqual([cookieA, cookieB]);
      // The Expires date has a comma: joining would corrupt it.
      expect(res.headers.getSetCookie()[1]).toContain("Expires=Wed, 21 Oct 2026");
    });

    it("no Cookie / no Set-Cookie: nothing invented", async () => {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(new Headers(init?.headers).has("cookie")).toBe(false);
        return new Response("{}", { status: 200 });
      });
      const res = await proxyCopilotRequest(new Request("http://localhost/v1/copilot/health"), {
        pathSegments: ["health"],
        fetchImpl: fetchImpl as typeof fetch,
        getUpstreamUrl: () => "http://upstream:8000",
      });
      expect(res.headers.getSetCookie()).toEqual([]);
    });
  });
});
