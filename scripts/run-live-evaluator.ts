import Redis from "ioredis";

import { getBotConfig, recordLiveObservation, recordMarketPipelineHealth } from "../server/db";
import { deliverLiveObservationAlert } from "../server/market-data/live-alerts";
import { createLiveEvaluatorService } from "../server/market-data/live-evaluator";
import { createMarketCache } from "../server/market-data/redis-cache";
import type { LiveAssetSymbol } from "../shared/live-market-types";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  if (process.env.MARKET_EVALUATOR_ENABLED !== "true") throw new Error("MARKET_EVALUATOR_ENABLED must be true to run the live evaluator");
  const redisUrl = process.env.MARKET_REDIS_URL ?? "redis://redis:6379/0";
  const cacheRedis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const evaluator = createLiveEvaluatorService({
    readSnapshot: (assetSymbol) => createMarketCache(cacheRedis).readSnapshot(assetSymbol),
    getConfig: getBotConfig,
    recordObservation: recordLiveObservation,
    deliverAlert: deliverLiveObservationAlert,
  });
  let wakeRequested = true;
  let stopping = false;
  const interval = Number.parseInt(process.env.MARKET_EVALUATOR_INTERVAL_MS ?? "1000", 10);
  const intervalMs = Number.isFinite(interval) && interval > 0 ? Math.min(interval, 60_000) : 1000;

  await subscriber.subscribe("market:closed-kline");
  subscriber.on("message", () => {
    wakeRequested = true;
  });

  const shutdown = async () => {
    stopping = true;
    await Promise.all([cacheRedis.quit(), subscriber.quit()]);
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  while (!stopping) {
    if (wakeRequested) {
      wakeRequested = false;
      try {
        const config = await getBotConfig();
        const results = await Promise.all(config.watchlist.map((assetSymbol) => evaluator.evaluateAsset(assetSymbol as LiveAssetSymbol)));
        await recordMarketPipelineHealth({
          component: "EVALUATOR",
          state: "RUNNING",
          lastSuccessAt: new Date(),
          lastError: null,
          lagMs: 0,
          summary: { observations: results.reduce((total, result) => total + result.observations.length, 0) },
        });
      } catch (error) {
        await recordMarketPipelineHealth({
          component: "EVALUATOR",
          state: "DEGRADED",
          lastSuccessAt: null,
          lastError: error instanceof Error ? error.message : "live evaluator failure",
          lagMs: null,
          summary: {},
        });
      }
    }
    if (!stopping) {
      await sleep(intervalMs);
      wakeRequested = true;
    }
  }
}

void main().catch((error) => {
  console.error("[live-evaluator] startup failed", error);
  process.exit(1);
});
