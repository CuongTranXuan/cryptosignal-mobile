export const LIVE_ASSET_SYMBOLS = ["BTC/USDT", "ETH/USDT", "BNB/USDT"] as const;
export type LiveAssetSymbol = (typeof LIVE_ASSET_SYMBOLS)[number];

export const LIVE_STREAM_TYPES = ["AGG_TRADE", "BOOK_TICKER", "KLINE_UPDATE"] as const;
export type LiveStreamType = (typeof LIVE_STREAM_TYPES)[number];

export const LIVE_CONDITION_IDS = [
  "PRICE_DISPLACEMENT_V1",
  "SPREAD_ANOMALY_V1",
  "TRADE_FLOW_IMBALANCE_V1",
  "OPEN_CANDLE_THRESHOLD_V1",
] as const;
export type LiveConditionId = (typeof LIVE_CONDITION_IDS)[number];

export type LiveDataQualityState = "LIVE_UNCONFIRMED";

export type LiveMarketEvent = {
  eventId: string;
  schemaVersion: 1;
  venue: "BINANCE_PUBLIC";
  streamType: LiveStreamType;
  assetSymbol: LiveAssetSymbol;
  exchangeEventTime: string;
  ingestedAt: string;
  sourceConnectionId: string;
  isClosedCandle: boolean;
  integrityHash: string;
  payload: Record<string, string | number | boolean | null>;
};

export type LiveObservation = {
  id: string;
  assetSymbol: LiveAssetSymbol;
  observedAt: string;
  conditionId: LiveConditionId;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  score: number;
  dataQualityState: LiveDataQualityState;
  evidence: Record<string, number | string | boolean>;
  sourceEventIds: string[];
  configVersion: number;
};

export type LiveAlertConfig = {
  enabled: boolean;
  conditionIds: LiveConditionId[];
  threshold: number;
  cooldownMinutes: number;
};

export const DEFAULT_LIVE_ALERT_CONFIG: LiveAlertConfig = {
  enabled: false,
  conditionIds: [],
  threshold: 0.65,
  cooldownMinutes: 15,
};

export type LiveReplayWindow = {
  assetSymbol: LiveAssetSymbol;
  from: string;
  to: string;
  limit: number;
};

export type LiveMarketSnapshot = {
  assetSymbol: LiveAssetSymbol;
  latestTrade: LiveMarketEvent | null;
  latestBookTicker: LiveMarketEvent | null;
  latestKlines: Partial<Record<"30m" | "1h" | "4h", LiveMarketEvent>>;
  freshestEventTime: string | null;
  stale: boolean;
};

export type MarketComponentHealth = {
  component: "COLLECTOR" | "WRITER" | "EVALUATOR" | "MCP";
  state: "IDLE" | "RUNNING" | "DEGRADED" | "FAILED";
  lastSuccessAt: Date | null;
  lastError: string | null;
  lagMs: number | null;
  summary: Record<string, unknown>;
  updatedAt: Date | null;
};
