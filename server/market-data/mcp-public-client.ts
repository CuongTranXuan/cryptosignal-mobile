export const BINANCE_PUBLIC_MCP_ENDPOINT = "https://agent.binance.com/mcp/agentic";

const PROHIBITED_TOOL_NAME = /(place.?order|account|transfer|wallet|futures.?position|portfolio|trade|withdraw|deposit)/i;
const PROHIBITED_ARGUMENT_KEY = /(api.?key|secret|signature|order|quantity|recipient|address|account|transfer)/i;

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchLike = (input: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<FetchResponse>;

export class McpPublicUnavailableError extends Error {
  constructor(message = "Public MCP research is temporarily unavailable") {
    super(message);
    this.name = "McpPublicUnavailableError";
  }
}

export type PublicMcpClientOptions = {
  enabled?: boolean;
  endpoint?: string;
  publicToolIds?: string[];
  environmentToolIds?: string[];
  fetch?: FetchLike;
  timeoutMs?: number;
};

function uniqueIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function hasProhibitedArgument(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasProhibitedArgument);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => PROHIBITED_ARGUMENT_KEY.test(key) || hasProhibitedArgument(nested));
}

function parseToolNames(body: unknown) {
  if (!body || typeof body !== "object") return [];
  const result = (body as { result?: unknown }).result;
  const tools = result && typeof result === "object" && "tools" in result ? (result as { tools?: unknown }).tools : undefined;
  return Array.isArray(tools) ? uniqueIds(tools.flatMap((tool) => tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string" ? [(tool as { name: string }).name] : [])) : [];
}

export function createPublicMcpClient(options: PublicMcpClientOptions = {}) {
  const enabled = options.enabled ?? process.env.BINANCE_MCP_ENABLED === "true";
  const endpoint = options.endpoint ?? BINANCE_PUBLIC_MCP_ENDPOINT;
  const fetcher = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const recordedAllowlist = new Set(uniqueIds(options.publicToolIds ?? (process.env.BINANCE_MCP_PUBLIC_TOOL_IDS ?? "").split(",")));
  const environmentAllowlist = new Set(uniqueIds(options.environmentToolIds ?? (process.env.BINANCE_MCP_PUBLIC_TOOL_IDS ?? "").split(",")));
  const timeoutMs = options.timeoutMs ?? 8_000;

  async function call(method: "tools/list" | "tools/call", params: Record<string, unknown>) {
    if (!fetcher) throw new McpPublicUnavailableError("Fetch is unavailable for the public MCP adapter");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: globalThis.crypto?.randomUUID?.() ?? `mcp-${Date.now()}`, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new McpPublicUnavailableError(`Public MCP request failed with HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error instanceof McpPublicUnavailableError) throw error;
      throw new McpPublicUnavailableError(error instanceof Error ? error.message : "Public MCP request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    enabled,
    publicToolIds: () => [...recordedAllowlist].filter((toolId) => environmentAllowlist.has(toolId)).sort(),
    async listPublicTools() {
      if (!enabled) return [];
      return parseToolNames(await call("tools/list", {}));
    },
    async invokePublicTool(toolName: string, args: Record<string, unknown>) {
      if (!enabled || PROHIBITED_TOOL_NAME.test(toolName) || !recordedAllowlist.has(toolName) || !environmentAllowlist.has(toolName)) {
        throw new Error("MCP tool is not allowed");
      }
      if (hasProhibitedArgument(args)) throw new Error("MCP arguments include a prohibited field");
      return call("tools/call", { name: toolName, arguments: args });
    },
  };
}

export function createConfiguredPublicMcpClient() {
  return createPublicMcpClient();
}
