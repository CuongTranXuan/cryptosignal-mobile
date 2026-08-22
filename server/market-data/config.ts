import type { LiveAssetSymbol } from "../../shared/live-market-types";

export const PUBLIC_BINANCE_COMBINED_STREAM_ENDPOINT = "wss://stream.binance.com:9443/stream";
export const MARKET_TIMEFRAMES = ["30m", "1h", "4h"] as const;
export type MarketTimeframe = (typeof MARKET_TIMEFRAMES)[number];

const assetToBinanceSymbol: Record<LiveAssetSymbol, string> = {
  "BTC/USDT": "btcusdt",
  "ETH/USDT": "ethusdt",
  "BNB/USDT": "bnbusdt",
};

export type MarketCollectorConfig = {
  assetSymbols: LiveAssetSymbol[];
  timeframes: MarketTimeframe[];
  endpoint?: string;
};

export function buildBinanceCombinedStreamUrl(config: MarketCollectorConfig) {
  const endpoint = config.endpoint ?? PUBLIC_BINANCE_COMBINED_STREAM_ENDPOINT;
  const url = new URL(endpoint);
  const documentedPublicEndpoint = endpoint === PUBLIC_BINANCE_COMBINED_STREAM_ENDPOINT;
  const testEndpoint = url.protocol === "ws:" && (url.hostname === "test.local" || url.hostname.endsWith(".test"));

  if (!documentedPublicEndpoint && !testEndpoint) {
    throw new Error("Market collector endpoint must be Binance public WSS or an explicit test endpoint");
  }
  if (config.assetSymbols.length === 0 || config.timeframes.length === 0) {
    throw new Error("Market collector requires at least one approved symbol and timeframe");
  }

  const streams = config.assetSymbols.flatMap((assetSymbol) => {
    const binanceSymbol = assetToBinanceSymbol[assetSymbol];
    if (!binanceSymbol) {
      throw new Error(`Unsupported public market symbol: ${assetSymbol}`);
    }
    return [
      `${binanceSymbol}@aggTrade`,
      `${binanceSymbol}@bookTicker`,
      ...config.timeframes.map((timeframe) => `${binanceSymbol}@kline_${timeframe}`),
    ];
  });

  url.search = new URLSearchParams({ streams: streams.join("/") }).toString();
  return url.toString();
}
