import { createHash } from "node:crypto";

import { z } from "zod";

import type { LiveAssetSymbol, LiveMarketEvent, LiveStreamType } from "../../shared/live-market-types";

const binanceSymbolToAsset: Record<string, LiveAssetSymbol> = {
  BTCUSDT: "BTC/USDT",
  ETHUSDT: "ETH/USDT",
  BNBUSDT: "BNB/USDT",
};

const sourceScalar = z.union([z.string(), z.number(), z.boolean()]);

const aggregateTradeSchema = z.object({
  e: z.literal("aggTrade"),
  E: z.number(),
  s: z.string(),
  a: sourceScalar,
  p: z.string(),
  q: z.string(),
  f: sourceScalar,
  l: sourceScalar,
  T: z.number(),
  m: z.boolean(),
  M: z.boolean(),
});

const bookTickerSchema = z.object({
  u: sourceScalar,
  s: z.string(),
  b: z.string(),
  B: z.string(),
  a: z.string(),
  A: z.string(),
});

const klineSchema = z.object({
  e: z.literal("kline"),
  E: z.number(),
  s: z.string(),
  k: z.object({
    t: sourceScalar,
    T: sourceScalar,
    s: z.string(),
    i: z.enum(["30m", "1h", "4h"]),
    f: sourceScalar,
    L: sourceScalar,
    o: z.string(),
    c: z.string(),
    h: z.string(),
    l: z.string(),
    v: z.string(),
    n: sourceScalar,
    x: z.boolean(),
    q: z.string(),
    V: z.string(),
    Q: z.string(),
    B: z.string(),
  }),
});

export type BinanceNormalizationContext = {
  ingestedAt: string;
  sourceConnectionId: string;
};

function asString(value: string | number | boolean) {
  return String(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function eventIntegrityHash(event: Omit<LiveMarketEvent, "eventId" | "integrityHash">) {
  return sha256(stableJson(event));
}

function buildEvent(input: Omit<LiveMarketEvent, "eventId" | "integrityHash">): LiveMarketEvent {
  const integrityHash = eventIntegrityHash(input);
  const event = { ...input, integrityHash } as LiveMarketEvent;
  return { ...event, eventId: createEventId(event) };
}

function streamDetails(stream: string): { sourceSymbol: string; streamType: LiveStreamType; interval?: "30m" | "1h" | "4h" } | null {
  const aggregateTrade = /^([a-z0-9]+)@aggTrade$/.exec(stream);
  if (aggregateTrade) {
    return { sourceSymbol: aggregateTrade[1].toUpperCase(), streamType: "AGG_TRADE" };
  }

  const bookTicker = /^([a-z0-9]+)@bookTicker$/.exec(stream);
  if (bookTicker) {
    return { sourceSymbol: bookTicker[1].toUpperCase(), streamType: "BOOK_TICKER" };
  }

  const kline = /^([a-z0-9]+)@kline_(30m|1h|4h)$/.exec(stream);
  if (kline) {
    return { sourceSymbol: kline[1].toUpperCase(), streamType: "KLINE_UPDATE", interval: kline[2] as "30m" | "1h" | "4h" };
  }

  return null;
}

function expectedAsset(sourceSymbol: string) {
  return binanceSymbolToAsset[sourceSymbol] ?? null;
}

export function createEventId(event: Omit<LiveMarketEvent, "eventId">) {
  const sourceSequence =
    event.payload.aggregateTradeId ?? event.payload.updateId ?? event.payload.lastTradeId ?? event.payload.openTime ?? "none";

  return sha256(
    stableJson({
      venue: event.venue,
      streamType: event.streamType,
      assetSymbol: event.assetSymbol,
      exchangeEventTime: event.exchangeEventTime,
      sourceSequence,
      integrityHash: event.integrityHash,
    }),
  );
}

export function normalizeBinanceCombinedStream(input: unknown, context: BinanceNormalizationContext): LiveMarketEvent | null {
  const combined = z.object({ stream: z.string(), data: z.unknown() }).safeParse(input);
  if (!combined.success) {
    return null;
  }

  const details = streamDetails(combined.data.stream);
  if (!details) {
    return null;
  }
  const assetSymbol = expectedAsset(details.sourceSymbol);
  if (!assetSymbol) {
    return null;
  }

  if (details.streamType === "AGG_TRADE") {
    const aggregateTrade = aggregateTradeSchema.safeParse(combined.data.data);
    if (!aggregateTrade.success || aggregateTrade.data.s !== details.sourceSymbol) {
      return null;
    }

    return buildEvent({
      schemaVersion: 1,
      venue: "BINANCE_PUBLIC",
      streamType: "AGG_TRADE",
      assetSymbol,
      exchangeEventTime: new Date(aggregateTrade.data.E).toISOString(),
      ingestedAt: context.ingestedAt,
      sourceConnectionId: context.sourceConnectionId,
      isClosedCandle: false,
      payload: {
        aggregateTradeId: asString(aggregateTrade.data.a),
        price: aggregateTrade.data.p,
        quantity: aggregateTrade.data.q,
        firstTradeId: asString(aggregateTrade.data.f),
        lastTradeId: asString(aggregateTrade.data.l),
        eventTime: asString(aggregateTrade.data.E),
        tradeTime: asString(aggregateTrade.data.T),
        buyerIsMarketMaker: aggregateTrade.data.m,
        ignore: aggregateTrade.data.M,
      },
    });
  }

  if (details.streamType === "BOOK_TICKER") {
    const bookTicker = bookTickerSchema.safeParse(combined.data.data);
    if (!bookTicker.success || bookTicker.data.s !== details.sourceSymbol) {
      return null;
    }

    return buildEvent({
      schemaVersion: 1,
      venue: "BINANCE_PUBLIC",
      streamType: "BOOK_TICKER",
      assetSymbol,
      // The public book-ticker payload has no exchange event timestamp; retain the collector receipt time.
      exchangeEventTime: context.ingestedAt,
      ingestedAt: context.ingestedAt,
      sourceConnectionId: context.sourceConnectionId,
      isClosedCandle: false,
      payload: {
        updateId: asString(bookTicker.data.u),
        bidPrice: bookTicker.data.b,
        bidQuantity: bookTicker.data.B,
        askPrice: bookTicker.data.a,
        askQuantity: bookTicker.data.A,
      },
    });
  }

  const kline = klineSchema.safeParse(combined.data.data);
  if (
    !kline.success ||
    kline.data.s !== details.sourceSymbol ||
    kline.data.k.s !== details.sourceSymbol ||
    kline.data.k.i !== details.interval
  ) {
    return null;
  }

  return buildEvent({
    schemaVersion: 1,
    venue: "BINANCE_PUBLIC",
    streamType: "KLINE_UPDATE",
    assetSymbol,
    exchangeEventTime: new Date(kline.data.E).toISOString(),
    ingestedAt: context.ingestedAt,
    sourceConnectionId: context.sourceConnectionId,
    isClosedCandle: kline.data.k.x,
    payload: {
      eventTime: asString(kline.data.E),
      interval: kline.data.k.i,
      openTime: asString(kline.data.k.t),
      closeTime: asString(kline.data.k.T),
      firstTradeId: asString(kline.data.k.f),
      lastTradeId: asString(kline.data.k.L),
      open: kline.data.k.o,
      close: kline.data.k.c,
      high: kline.data.k.h,
      low: kline.data.k.l,
      baseVolume: kline.data.k.v,
      tradeCount: asString(kline.data.k.n),
      isClosed: kline.data.k.x,
      quoteVolume: kline.data.k.q,
      takerBuyBaseVolume: kline.data.k.V,
      takerBuyQuoteVolume: kline.data.k.Q,
      ignored: kline.data.k.B,
    },
  });
}
