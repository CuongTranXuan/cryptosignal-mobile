export const SIGNAL_STATES = ["BULLISH_SETUP", "BEARISH_SETUP", "NEUTRAL"] as const;

import type { LiveAlertConfig } from "./live-market-types";

export const CANDLE_PATTERNS = [
  { id: "DOJI_V1", label: "Doji", group: "Single-candle", explanation: "A small real body signals market indecision after the candle has closed." },
  { id: "HAMMER_V1", label: "Hammer", group: "Single-candle", explanation: "A lower shadow with a closed upper body can show rejected lower prices." },
  { id: "INVERTED_HAMMER_V1", label: "Inverted Hammer", group: "Single-candle", explanation: "An upper shadow after weakness can show an attempted reversal; confirmation is required." },
  { id: "SHOOTING_STAR_V1", label: "Shooting Star", group: "Single-candle", explanation: "An upper shadow after strength can show rejected higher prices." },
  { id: "HANGING_MAN_V1", label: "Hanging Man", group: "Single-candle", explanation: "A lower shadow after strength can flag possible selling pressure; confirmation is required." },
  { id: "SPINNING_TOP_V1", label: "Spinning Top", group: "Single-candle", explanation: "A small body with two shadows signals indecision rather than directional confirmation." },
  { id: "BULLISH_ENGULFING_V1", label: "Bullish Engulfing", group: "Two-candle", explanation: "The latest bullish body engulfs the prior bearish body on a closed candle." },
  { id: "BEARISH_ENGULFING_V1", label: "Bearish Engulfing", group: "Two-candle", explanation: "The latest bearish body engulfs the prior bullish body on a closed candle." },
  { id: "BULLISH_HARAMI_V1", label: "Bullish Harami", group: "Two-candle", explanation: "A smaller bullish body sits within the prior bearish body on closed candles." },
  { id: "BEARISH_HARAMI_V1", label: "Bearish Harami", group: "Two-candle", explanation: "A smaller bearish body sits within the prior bullish body on closed candles." },
  { id: "TWEEZER_TOP_V1", label: "Tweezer Top", group: "Two-candle", explanation: "Similar consecutive highs with a bearish close can signal rejected resistance." },
  { id: "TWEEZER_BOTTOM_V1", label: "Tweezer Bottom", group: "Two-candle", explanation: "Similar consecutive lows with a bullish close can signal rejected support." },
  { id: "MORNING_STAR_V1", label: "Morning Star", group: "Three-candle", explanation: "A three-candle reversal structure ending with a bullish recovery." },
  { id: "EVENING_STAR_V1", label: "Evening Star", group: "Three-candle", explanation: "A three-candle reversal structure ending with a bearish decline." },
  { id: "THREE_WHITE_SOLDIERS_V1", label: "Three White Soldiers", group: "Three-candle", explanation: "Three successive bullish closes can confirm sustained buying pressure." },
  { id: "THREE_BLACK_CROWS_V1", label: "Three Black Crows", group: "Three-candle", explanation: "Three successive bearish closes can confirm sustained selling pressure." },
  { id: "THREE_INSIDE_UP_V1", label: "Three Inside Up", group: "Three-candle", explanation: "A harami followed by a bullish confirmation close." },
  { id: "THREE_INSIDE_DOWN_V1", label: "Three Inside Down", group: "Three-candle", explanation: "A harami followed by a bearish confirmation close." },
] as const;

export const CANDLE_PATTERN_RULE_IDS = CANDLE_PATTERNS.map((pattern) => pattern.id);
export type CandlePatternRuleId = (typeof CANDLE_PATTERNS)[number]["id"];
export const RULE_FAMILY_IDS = ["TREND", "MOMENTUM", "VOLUME", "CANDLE_PATTERN", "WYCKOFF", "SMC", "ELLIOTT_EXPERIMENTAL"] as const;
export type RuleFamilyId = (typeof RULE_FAMILY_IDS)[number];

export const METHODOLOGY_RULES = [
  { id: "EMA_TREND_V1", label: "EMA trend alignment", family: "TREND", explanation: "EMA20, EMA50, and EMA200 align in one direction on a closed candle." },
  { id: "RSI_MACD_CONFIRMATION_V1", label: "RSI + MACD confirmation", family: "MOMENTUM", explanation: "RSI and MACD agree on directional momentum after the candle has closed." },
  { id: "VOLUME_CONFIRMATION_V1", label: "Relative-volume confirmation", family: "VOLUME", explanation: "Closed-candle volume is at or above its recent average in the candle direction." },
  { id: "WYCKOFF_SPRING_PROXY_V1", label: "Wyckoff spring proxy", family: "WYCKOFF", explanation: "A lower-range sweep closes back above prior support with volume confirmation." },
  { id: "WYCKOFF_UPTHRUST_PROXY_V1", label: "Wyckoff upthrust proxy", family: "WYCKOFF", explanation: "An upper-range sweep closes back below prior resistance with volume confirmation." },
  { id: "SMC_BULLISH_BOS_PROXY_V1", label: "SMC bullish break of structure proxy", family: "SMC", explanation: "A closed candle breaks above the preceding range high with volume confirmation." },
  { id: "SMC_BEARISH_BOS_PROXY_V1", label: "SMC bearish break of structure proxy", family: "SMC", explanation: "A closed candle breaks below the preceding range low with volume confirmation." },
  { id: "ELLIOTT_BULLISH_IMPULSE_PROXY_V1", label: "Elliott bullish impulse proxy", family: "ELLIOTT_EXPERIMENTAL", explanation: "Successive higher closes align with the short-term EMA structure; this is an experimental proxy, not wave counting." },
  { id: "ELLIOTT_BEARISH_IMPULSE_PROXY_V1", label: "Elliott bearish impulse proxy", family: "ELLIOTT_EXPERIMENTAL", explanation: "Successive lower closes align with the short-term EMA structure; this is an experimental proxy, not wave counting." },
] as const;

export const METHODOLOGY_RULE_IDS = METHODOLOGY_RULES.map((rule) => rule.id);
export type MethodologyRuleId = (typeof METHODOLOGY_RULES)[number]["id"];

export type SignalState = (typeof SIGNAL_STATES)[number];

export type SignalFinding = {
  findingId: string;
  ruleFamily: string;
  ruleId: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  strength: number;
  evidence: Record<string, unknown>;
};

export type SignalSnapshotInput = {
  id: string;
  assetSymbol: string;
  venue: string;
  timeframe: string;
  candleCloseTime: string;
  state: SignalState;
  score: number;
  confidence: number;
  regime: string;
  dataQualityState: string;
  findings: SignalFinding[];
  conflicts: string[];
  invalidation: Record<string, unknown>;
  strategyVersion: string;
  configVersion: number;
  sourceManifestId: string;
};

export type BotConfigView = {
  configVersion: number;
  lastChangedBy: "SYSTEM" | "TELEGRAM" | "DASHBOARD";
  isPaused: boolean;
  watchlist: string[];
  timeframes: string[];
  ruleFamilies: RuleFamilyId[];
  enabledPatterns: CandlePatternRuleId[];
  enabledMethodologies: MethodologyRuleId[];
  liveAlerts: LiveAlertConfig;
  alertThreshold: number;
  cooldownMinutes: number;
  quietHours: { start: string; end: string; timezone: string };
};

export type CandlePointInput = {
  id: string;
  assetSymbol: string;
  venue: string;
  timeframe: string;
  candleCloseTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  atr14: number;
  signalState: SignalState;
  signalScore: number;
  strategyVersion: string;
  configVersion: number;
};

export type ConditionalScenario = {
  id: "BULLISH_CONTINUATION" | "BEARISH_CONTINUATION" | "RANGE_OR_REVERSAL";
  label: string;
  condition: string;
  invalidation: string;
  researchWindow: string;
  observedVolatilityBand: { lower: number; upper: number };
  evidence: string[];
};

export type RunnerHealthState = "IDLE" | "RUNNING" | "SUCCESS" | "DEGRADED" | "PAUSED";

export type RunnerHealthView = {
  runId: string | null;
  state: RunnerHealthState;
  configVersion: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  cycleCount: number;
  failureCount: number;
  lastError: string | null;
  summary: Record<string, unknown>;
  updatedAt: Date | null;
};

export type AuditEventView = {
  id: string;
  action: string;
  actorType: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};
