import type { LiveAssetSymbol, LiveMarketEvent, LiveMarketSnapshot } from "../../shared/live-market-types";

const CACHE_TTL_SECONDS = 10 * 60;
const CACHE_TIMEFRAMES = ["30m", "1h", "4h"] as const;

export type RedisMarketClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
};

export type MarketCacheOptions = {
  now?: () => Date;
  staleAfterMs?: number;
};

export class MarketCacheUnavailableError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Live market cache is unavailable");
    this.name = "MarketCacheUnavailableError";
    this.cause = cause;
  }
}

export type MarketCache = {
  writeLatest(event: LiveMarketEvent): Promise<void>;
  readSnapshot(symbol: LiveAssetSymbol): Promise<LiveMarketSnapshot>;
};

function getStaleAfterMs() {
  const configured = Number.parseInt(process.env.MARKET_STALE_AFTER_MS ?? "60000", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

function keyForEvent(event: LiveMarketEvent) {
  const prefix = `market:latest:${event.assetSymbol}`;
  if (event.streamType === "AGG_TRADE") {
    return `${prefix}:trade`;
  }
  if (event.streamType === "BOOK_TICKER") {
    return `${prefix}:book`;
  }

  const interval = event.payload.interval;
  if (typeof interval !== "string" || !CACHE_TIMEFRAMES.includes(interval as (typeof CACHE_TIMEFRAMES)[number])) {
    return null;
  }
  return `${prefix}:kline:${interval}`;
}

function parseEvent(value: string | null): LiveMarketEvent | null {
  if (!value) {
    return null;
  }
  return JSON.parse(value) as LiveMarketEvent;
}

export function createMarketCache(client: RedisMarketClient, options: MarketCacheOptions = {}): MarketCache {
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? getStaleAfterMs();

  return {
    async writeLatest(event) {
      const key = keyForEvent(event);
      if (!key) {
        return;
      }
      try {
        await client.set(key, JSON.stringify(event), "EX", CACHE_TTL_SECONDS);
      } catch (error) {
        throw new MarketCacheUnavailableError(error);
      }
    },

    async readSnapshot(assetSymbol) {
      const prefix = `market:latest:${assetSymbol}`;
      try {
        const [tradeValue, bookValue, ...klineValues] = await Promise.all([
          client.get(`${prefix}:trade`),
          client.get(`${prefix}:book`),
          ...CACHE_TIMEFRAMES.map((timeframe) => client.get(`${prefix}:kline:${timeframe}`)),
        ]);
        const latestTrade = parseEvent(tradeValue);
        const latestBookTicker = parseEvent(bookValue);
        const latestKlines: LiveMarketSnapshot["latestKlines"] = {};

        CACHE_TIMEFRAMES.forEach((timeframe, index) => {
          const event = parseEvent(klineValues[index]);
          if (event) {
            latestKlines[timeframe] = event;
          }
        });

        const eventTimes = [latestTrade, latestBookTicker, ...Object.values(latestKlines)]
          .filter((event): event is LiveMarketEvent => event !== null && event !== undefined)
          .map((event) => event.exchangeEventTime)
          .sort();
        const freshestEventTime = eventTimes.at(-1) ?? null;
        const stale = freshestEventTime ? now().getTime() - new Date(freshestEventTime).getTime() > staleAfterMs : true;

        return { assetSymbol, latestTrade, latestBookTicker, latestKlines, freshestEventTime, stale };
      } catch (error) {
        throw new MarketCacheUnavailableError(error);
      }
    },
  };
}
