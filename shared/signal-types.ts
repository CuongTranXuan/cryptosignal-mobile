export const SIGNAL_STATES = ["BULLISH_SETUP", "BEARISH_SETUP", "NEUTRAL"] as const;
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
  ruleFamilies: string[];
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
