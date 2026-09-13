import type { Candle, Interval } from "./pattern-shape";

export const BINANCE_REST = "https://api.binance.com";
export const BINANCE_WS = "wss://stream.binance.com:9443/ws";

const SPOT_USDT = /^[A-Z0-9]+USDT$/;

export function normalizeSpotSymbol(raw: string): string | null {
  const normalized = raw.replaceAll("/", "").toUpperCase();
  return SPOT_USDT.test(normalized) ? normalized : null;
}

export type KlinesUrlOptions = {
  limit?: number;
  startTimeMs?: number;
  endTimeMs?: number;
};

export function klinesUrl(
  symbol: string,
  interval: Interval | string,
  limitOrOptions: number | KlinesUrlOptions = 500,
): string {
  const opts: KlinesUrlOptions =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const limit = opts.limit ?? 500;
  const params = new URLSearchParams({
    symbol,
    interval: String(interval),
    limit: String(limit),
  });
  if (opts.startTimeMs != null) params.set("startTime", String(opts.startTimeMs));
  if (opts.endTimeMs != null) params.set("endTime", String(opts.endTimeMs));
  return `${BINANCE_REST}/api/v3/klines?${params.toString()}`;
}

export function tickerUrl(symbol: string): string {
  return `${BINANCE_REST}/api/v3/ticker/24hr?symbol=${symbol}`;
}

export function klineStreamUrl(symbol: string, interval: Interval | string): string {
  return `${BINANCE_WS}/${symbol.toLowerCase()}@kline_${interval}`;
}

export function parseKlineRestRow(row: unknown[]): Candle {
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

export function parseWsKline(
  payload: unknown,
): { candle: Candle; closed: boolean; symbol: string; interval: string } | null {
  if (payload == null || typeof payload !== "object") return null;
  const msg = payload as Record<string, unknown>;
  const k = msg.k;
  if (typeof msg.s !== "string" || k == null || typeof k !== "object") return null;
  const bar = k as Record<string, unknown>;
  if (
    typeof bar.t !== "number" ||
    bar.o == null ||
    bar.h == null ||
    bar.l == null ||
    bar.c == null ||
    bar.v == null ||
    typeof bar.x !== "boolean" ||
    typeof bar.i !== "string"
  ) {
    return null;
  }
  return {
    symbol: msg.s,
    interval: bar.i,
    closed: bar.x,
    candle: {
      time: Math.floor(bar.t / 1000),
      open: Number(bar.o),
      high: Number(bar.h),
      low: Number(bar.l),
      close: Number(bar.c),
      volume: Number(bar.v),
    },
  };
}

export function mergeCandles(existing: Candle[], incoming: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of existing) byTime.set(candle.time, candle);
  for (const candle of incoming) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
