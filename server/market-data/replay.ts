import { createClient } from "@clickhouse/client";
import Redis from "ioredis";

import type { LiveAssetSymbol, LiveMarketEvent, LiveMarketSnapshot } from "../../shared/live-market-types";
import { createMarketCache, type MarketCache, MarketCacheUnavailableError } from "./redis-cache";

export const MAX_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_REPLAY_EVENTS = 5_000;

type ClickHouseReplayRow = {
  event_id: string;
  venue: "BINANCE_PUBLIC";
  stream_type: LiveMarketEvent["streamType"];
  asset_symbol: LiveAssetSymbol;
  exchange_event_time: string;
  ingested_at: string;
  source_connection_id: string;
  is_closed_candle: number | boolean;
  integrity_hash: string;
  payload_json: string;
};

export type ClickHouseReplayClient = {
  query(input: { query: string; query_params: Record<string, string | number>; format: "JSONEachRow" }): Promise<{
    json(): Promise<unknown[]>;
  }>;
};

export type ReplayWindow = {
  assetSymbol: LiveAssetSymbol;
  from: string;
  to: string;
  limit: number;
};

function parsePayload(payloadJson: string) {
  const payload = JSON.parse(payloadJson);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("ClickHouse replay row has an invalid payload");
  }
  return payload as LiveMarketEvent["payload"];
}

function toLiveMarketEvent(row: ClickHouseReplayRow): LiveMarketEvent {
  return {
    eventId: row.event_id,
    schemaVersion: 1,
    venue: row.venue,
    streamType: row.stream_type,
    assetSymbol: row.asset_symbol,
    exchangeEventTime: row.exchange_event_time,
    ingestedAt: row.ingested_at,
    sourceConnectionId: row.source_connection_id,
    isClosedCandle: row.is_closed_candle === true || row.is_closed_candle === 1,
    integrityHash: row.integrity_hash,
    payload: parsePayload(row.payload_json),
  };
}

export function validateReplayWindow(window: ReplayWindow) {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    throw new Error("Replay window must use an increasing ISO-8601 time range");
  }
  if (to - from > MAX_REPLAY_WINDOW_MS) {
    throw new Error("Replay window cannot exceed seven days");
  }
  if (!Number.isInteger(window.limit) || window.limit < 1 || window.limit > MAX_REPLAY_EVENTS) {
    throw new Error("Replay limit must be between 1 and 5,000 events");
  }
}

export function createMarketReplayService(client: ClickHouseReplayClient) {
  return {
    async queryReplayWindow(window: ReplayWindow): Promise<LiveMarketEvent[]> {
      validateReplayWindow(window);
      const result = await client.query({
        query: `
          SELECT event_id, venue, stream_type, asset_symbol, exchange_event_time, ingested_at,
                 source_connection_id, is_closed_candle, integrity_hash, payload_json
          FROM market_events
          WHERE asset_symbol = {assetSymbol:String}
            AND exchange_event_time >= parseDateTime64BestEffort({from:String})
            AND exchange_event_time < parseDateTime64BestEffort({to:String})
          ORDER BY exchange_event_time ASC, event_id ASC
          LIMIT {limit:UInt64}
        `,
        query_params: {
          assetSymbol: window.assetSymbol,
          from: window.from,
          to: window.to,
          limit: window.limit,
        },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as ClickHouseReplayRow[];
      return rows.map(toLiveMarketEvent);
    },
  };
}

export function createConfiguredReplayService() {
  const client = createClient({
    url: process.env.CLICKHOUSE_URL ?? "http://clickhouse:8123",
    username: process.env.CLICKHOUSE_USER ?? "cryptosignal",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    database: "marketdata",
  });
  const service = createMarketReplayService({
    async query(input) {
      const result = await client.query(input);
      return { json: () => result.json() as Promise<unknown[]> };
    },
  });
  return { ...service, close: () => client.close() };
}

export async function readConfiguredLiveSnapshot(assetSymbol: LiveAssetSymbol): Promise<LiveMarketSnapshot> {
  const redis = new Redis(process.env.MARKET_REDIS_URL ?? "redis://redis:6379/0", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redis.on("error", () => undefined);
  let connected = false;
  try {
    await redis.connect();
    connected = true;
    return await createMarketCache(redis).readSnapshot(assetSymbol);
  } finally {
    if (connected) await redis.quit();
    else redis.disconnect(false);
  }
}

export async function readLiveSnapshot(cache: MarketCache, assetSymbol: LiveAssetSymbol): Promise<LiveMarketSnapshot> {
  return cache.readSnapshot(assetSymbol);
}

export { MarketCacheUnavailableError };
