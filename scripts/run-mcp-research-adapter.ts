import { recordMarketPipelineHealth } from "../server/db";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  let stopping = false;
  const shutdown = () => { stopping = true; };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  while (!stopping) {
    await recordMarketPipelineHealth({
      component: "MCP",
      state: "IDLE",
      lastSuccessAt: null,
      lastError: null,
      lagMs: null,
      summary: { mode: "public-read-only", enabled: process.env.BINANCE_MCP_ENABLED === "true", automaticRequests: false },
    });
    await sleep(30_000);
  }
}

void main().catch((error) => {
  console.error("[mcp-research-adapter] startup failed", error);
  process.exit(1);
});
