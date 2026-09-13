import {
  klineStreamUrl,
  klinesUrl,
  parseKlineRestRow,
  tickerUrl,
} from "./binance";
import type { Candle, Interval } from "./pattern-shape";

export class BinanceApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "BinanceApiError";
    this.code = code;
  }
}

export type KlinesSnapshot = {
  candles: Candle[];
  closeTimesMs: number[];
};

export type WsHandlers = {
  onMessage: (payload: unknown) => void;
  onClose: () => void;
  onError: () => void;
};

export type WsConnection = {
  close: () => void;
};

export type FetchKlines = (
  symbol: string,
  interval: string,
  limit?: number,
) => Promise<KlinesSnapshot>;

export type FetchTicker = (symbol: string) => Promise<number>;

export type ConnectWs = (
  symbol: string,
  interval: string,
  handlers: WsHandlers,
) => WsConnection;

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 500,
): Promise<KlinesSnapshot> {
  const res = await fetch(klinesUrl(symbol, interval, limit));
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const code =
      body && typeof body === "object" && "code" in body
        ? Number((body as { code: unknown }).code)
        : res.status;
    const msg =
      body && typeof body === "object" && "msg" in body
        ? String((body as { msg: unknown }).msg)
        : res.statusText;
    throw new BinanceApiError(code, msg || `HTTP ${res.status}`);
  }

  if (!Array.isArray(body)) {
    throw new BinanceApiError(-1, "Unexpected klines response");
  }

  const candles: Candle[] = [];
  const closeTimesMs: number[] = [];
  for (const row of body) {
    if (!Array.isArray(row)) continue;
    candles.push(parseKlineRestRow(row));
    closeTimesMs.push(Number(row[6]));
  }
  return { candles, closeTimesMs };
}

export async function fetchTicker(symbol: string): Promise<number> {
  const res = await fetch(tickerUrl(symbol));
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const code =
      body && typeof body === "object" && "code" in body
        ? Number((body as { code: unknown }).code)
        : res.status;
    const msg =
      body && typeof body === "object" && "msg" in body
        ? String((body as { msg: unknown }).msg)
        : res.statusText;
    throw new BinanceApiError(code, msg || `HTTP ${res.status}`);
  }

  if (body == null || typeof body !== "object" || !("priceChangePercent" in body)) {
    throw new BinanceApiError(-1, "Unexpected ticker response");
  }
  return Number((body as { priceChangePercent: unknown }).priceChangePercent);
}

export function openKlineSocket(
  symbol: string,
  interval: Interval | string,
  handlers: WsHandlers,
): WsConnection {
  const ws = new WebSocket(klineStreamUrl(symbol, interval));
  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as unknown;
      handlers.onMessage(payload);
    } catch {
      // ignore malformed frames
    }
  };
  ws.onclose = () => handlers.onClose();
  ws.onerror = () => handlers.onError();
  return {
    close: () => {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    },
  };
}
