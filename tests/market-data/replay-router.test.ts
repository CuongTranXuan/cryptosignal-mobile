import { describe, expect, it, vi } from "vitest";

import { createMarketCache } from "../../server/market-data/redis-cache";
import { createMarketReplayService } from "../../server/market-data/replay";
import { appRouter, sanitizeMarketHealth } from "../../server/routers";

function createCaller() {
  return appRouter.createCaller({ user: null, dashboardUser: { id: 1, username: "test-owner", role: "admin" }, req: {} as never, res: {} as never });
}

const now = "2026-08-22T04:00:00.000Z";
const sixDaysEarlier = "2026-08-16T04:00:00.000Z";

describe("live market replay router", () => {
  it("limits replay to a seven-day window and 5,000 events", async () => {
    const market = createCaller().market as unknown as {
      replay(input: { assetSymbol: "BTC/USDT"; from: string; to: string; limit: number }): Promise<unknown>;
    };

    await expect(market.replay({ assetSymbol: "BTC/USDT", from: sixDaysEarlier, to: now, limit: 5001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(market.replay({ assetSymbol: "BTC/USDT", from: "2026-08-14T03:59:59.999Z", to: now, limit: 100 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("updates only live alert controls", async () => {
    const next = await createCaller().bot.controls.setLiveAlerts({
      enabled: true,
      conditionIds: ["SPREAD_ANOMALY_V1"],
      threshold: 0.7,
      cooldownMinutes: 10,
    });

    expect(next.liveAlerts).toEqual({ enabled: true, conditionIds: ["SPREAD_ANOMALY_V1"], threshold: 0.7, cooldownMinutes: 10 });
    expect(next.alertThreshold).toBe(0.55);
    expect(next.cooldownMinutes).toBe(60);
  });

  it("exposes secret-free component health rows", async () => {
    const market = createCaller().market as unknown as {
      health(): Promise<Array<{ component: string; state: string; summary: Record<string, unknown> }>>;
    };

    const health = await market.health();
    expect(health.map((entry) => entry.component)).toEqual(["COLLECTOR", "EVALUATOR", "MCP", "WRITER"]);
    expect(JSON.stringify(health)).not.toMatch(/secret|password|token/i);
  });

  it("redacts endpoint and credential-like content from market health errors before API presentation", () => {
    const health = sanitizeMarketHealth([{
      component: "WRITER",
      state: "DEGRADED",
      lastSuccessAt: null,
      lastError: "redis://cache.internal:6379 password=archive-secret X-Amz-Signature=abc",
      lagMs: null,
      summary: { endpoint: "http://clickhouse:8123", operation: "replay" },
      updatedAt: null,
    }]);

    expect(JSON.stringify(health)).not.toMatch(/redis:\/\/|clickhouse|archive-secret|X-Amz-Signature=abc/i);
  });

  it("marks a Redis-only snapshot stale when its cache has no live event and does not call any external market source", async () => {
    const redis = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };

    const snapshot = await createMarketCache(redis, { now: () => new Date(now) }).readSnapshot("BTC/USDT");

    expect(snapshot).toMatchObject({ assetSymbol: "BTC/USDT", stale: true, freshestEventTime: null, latestTrade: null });
    expect(redis.get).toHaveBeenCalledTimes(5);
  });

  it("queries ClickHouse in stable event-time and event-id order without any public REST fallback", async () => {
    const query = vi.fn(async () => ({
      json: async () => [
        {
          event_id: "same-time-b",
          venue: "BINANCE_PUBLIC",
          stream_type: "AGG_TRADE",
          asset_symbol: "BTC/USDT",
          exchange_event_time: now,
          ingested_at: now,
          source_connection_id: "collector",
          is_closed_candle: 0,
          integrity_hash: "hash-b",
          payload_json: '{"price":"1"}',
        },
      ],
    }));
    const replay = createMarketReplayService({ query });

    const events = await replay.queryReplayWindow({ assetSymbol: "BTC/USDT", from: sixDaysEarlier, to: now, limit: 10 });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("ORDER BY exchange_event_time ASC, event_id ASC"),
      }),
    );
    const calls = query.mock.calls as unknown as Array<[{ query: string }]>;
    expect(calls[0]?.[0].query).toContain("exchange_event_time < parseDateTime64BestEffort({to:String})");
    expect(events).toMatchObject([{ eventId: "same-time-b", payload: { price: "1" } }]);
  });

  it("surfaces ClickHouse unavailability rather than substituting a public REST request", async () => {
    const replay = createMarketReplayService({ query: async () => { throw new Error("ClickHouse unavailable"); } });

    await expect(replay.queryReplayWindow({ assetSymbol: "BTC/USDT", from: sixDaysEarlier, to: now, limit: 10 })).rejects.toThrow("ClickHouse unavailable");
  });
});
