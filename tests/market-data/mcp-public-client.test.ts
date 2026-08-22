import { describe, expect, it, vi } from "vitest";

import { createPublicMcpClient } from "../../server/market-data/mcp-public-client";

describe("public MCP research client", () => {
  it.each(["place_order", "account_balance", "transfer", "wallet", "futures_position"])("rejects prohibited MCP tool %s without a network request", async (toolName) => {
    const fetch = vi.fn();
    const client = createPublicMcpClient({ enabled: true, fetch, publicToolIds: [toolName] });

    await expect(client.invokePublicTool(toolName, {})).rejects.toThrow("MCP tool is not allowed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("runs no request when the MCP adapter is disabled", async () => {
    const fetch = vi.fn();
    const client = createPublicMcpClient({ enabled: false, fetch, publicToolIds: ["public_market_summary"] });

    await expect(client.listPublicTools()).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires an exact public allowlist intersection and rejects sensitive arguments before invocation", async () => {
    const fetch = vi.fn();
    const client = createPublicMcpClient({ enabled: true, fetch, publicToolIds: ["public_market_summary"], environmentToolIds: ["different_tool"] });

    await expect(client.invokePublicTool("public_market_summary", {})).rejects.toThrow("MCP tool is not allowed");
    const allowedClient = createPublicMcpClient({ enabled: true, fetch, publicToolIds: ["public_market_summary"], environmentToolIds: ["public_market_summary"] });
    await expect(allowedClient.invokePublicTool("public_market_summary", { apiKey: "must-not-send" })).rejects.toThrow("MCP arguments include a prohibited field");
    expect(fetch).not.toHaveBeenCalled();
  });
});
