import Redis from "ioredis";
import WebSocket from "ws";

import { recordAuditEvent, recordMarketPipelineHealth } from "../server/db";
import { createBinanceCollector } from "../server/market-data/binance-collector";
import { MARKET_TIMEFRAMES, type MarketTimeframe } from "../server/market-data/config";
import { createMarketCache } from "../server/market-data/redis-cache";
import { createMarketSpool } from "../server/market-data/spool";
import type { LiveAssetSymbol } from "../shared/live-market-types";

const DEFAULT_ASSET_SYMBOLS: LiveAssetSymbol[] = ["BTC/USDT", "ETH/USDT", "BNB/USDT"];

function parseTimeframes(value: string | undefined): MarketTimeframe[] {
  const parsed = (value ?? "30m,1h,4h").split(",").map((timeframe) => timeframe.trim());
  if (!parsed.every((timeframe): timeframe is MarketTimeframe => (MARKET_TIMEFRAMES as readonly string[]).includes(timeframe))) {
    throw new Error("MARKET_TIMEFRAMES must contain only 30m, 1h, and 4h");
  }
  return [...new Set(parsed)];
}

async function main() {
  if (process.env.MARKET_COLLECTOR_ENABLED !== "true") {
    throw new Error("MARKET_COLLECTOR_ENABLED must be true to run the public market collector");
  }

  const redis = new Redis(process.env.MARKET_REDIS_URL ?? "redis://redis:6379/0");
  const spool = await createMarketSpool({
    directory: process.env.MARKET_SPOOL_DIR ?? "/var/lib/cryptosignal/market-spool",
    maxBytes: 16 * 1024 * 1024,
    maxAgeMs: 5 * 60_000,
  });
  const collector = createBinanceCollector({
    config: {
      assetSymbols: DEFAULT_ASSET_SYMBOLS,
      timeframes: parseTimeframes(process.env.MARKET_TIMEFRAMES),
      endpoint: process.env.MARKET_BINANCE_WSS_ENDPOINT,
    },
    socketFactory: (url) => new WebSocket(url),
    spool,
    cache: createMarketCache(redis),
    publishClosedKline: (eventId) => redis.publish("market:closed-kline", eventId),
    recordAuditEvent,
    recordHealth: recordMarketPipelineHealth,
  });

  const shutdown = async () => {
    await collector.stop();
    await redis.quit();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  await collector.start();
}

void main().catch((error) => {
  console.error("[market-collector] startup failed", error);
  process.exit(1);
});
