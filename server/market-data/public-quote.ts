import { z } from "zod";

import { LIVE_ASSET_SYMBOLS } from "../../shared/live-market-types";

const binanceBookTickerSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]+$/),
  bidPrice: z.string().min(1),
  bidQty: z.string().min(1),
  askPrice: z.string().min(1),
  askQty: z.string().min(1),
});

const publicDataOrigin = "https://data-api.binance.vision";

export type PublicMarketQuote = {
  assetSymbol: (typeof LIVE_ASSET_SYMBOLS)[number];
  source: "BINANCE_PUBLIC_REST";
  observedAt: string;
  bidPrice: string;
  bidQuantity: string;
  askPrice: string;
  askQuantity: string;
};

export class PublicQuoteUnavailableError extends Error {
  constructor(message = "Public market quote is temporarily unavailable") {
    super(message);
    this.name = "PublicQuoteUnavailableError";
  }
}

type PublicQuoteServiceOptions = {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
};

function toBinanceSymbol(assetSymbol: (typeof LIVE_ASSET_SYMBOLS)[number]) {
  return assetSymbol.replace("/", "");
}

export function createPublicQuoteService({ fetcher = fetch, now = () => new Date() }: PublicQuoteServiceOptions = {}) {
  return {
    async getQuote(assetSymbol: (typeof LIVE_ASSET_SYMBOLS)[number]): Promise<PublicMarketQuote> {
      const symbol = toBinanceSymbol(assetSymbol);
      const url = `${publicDataOrigin}/api/v3/ticker/bookTicker?symbol=${symbol}`;
      let response: Response;

      try {
        response = await fetcher(url, { headers: undefined });
      } catch {
        throw new PublicQuoteUnavailableError();
      }

      if (!response.ok) {
        throw new PublicQuoteUnavailableError();
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PublicQuoteUnavailableError("Public market quote returned an unreadable response");
      }

      const parsed = binanceBookTickerSchema.safeParse(payload);
      if (!parsed.success || parsed.data.symbol !== symbol) {
        throw new PublicQuoteUnavailableError("Public market quote returned an invalid symbol response");
      }

      return {
        assetSymbol,
        source: "BINANCE_PUBLIC_REST",
        observedAt: now().toISOString(),
        bidPrice: parsed.data.bidPrice,
        bidQuantity: parsed.data.bidQty,
        askPrice: parsed.data.askPrice,
        askQuantity: parsed.data.askQty,
      };
    },
  };
}

export function createConfiguredPublicQuoteService() {
  return createPublicQuoteService();
}
