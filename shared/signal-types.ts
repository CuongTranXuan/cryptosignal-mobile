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
  isPaused: boolean;
  watchlist: string[];
  timeframes: string[];
  ruleFamilies: string[];
  alertThreshold: number;
  cooldownMinutes: number;
  quietHours: { start: string; end: string; timezone: string };
};
