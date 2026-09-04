import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRole("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
});

export const dashboardCredentials = pgTable(
  "dashboard_credentials",
  {
    id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
    username: varchar("username", { length: 64 }).notNull().unique(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    role: userRole("role").default("user").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dashboard_credentials_username_idx").on(table.username)],
);

export const dashboardSessions = pgTable(
  "dashboard_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    credentialId: integer("credentialId").notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dashboard_sessions_credential_idx").on(table.credentialId), index("dashboard_sessions_expiry_idx").on(table.expiresAt)],
);

export const botConfigs = pgTable("bot_configs", {
  id: integer("id").primaryKey(),
  configVersion: integer("configVersion").notNull(),
  isPaused: boolean("isPaused").default(false).notNull(),
  watchlistJson: text("watchlistJson").notNull(),
  timeframesJson: text("timeframesJson").notNull(),
  ruleFamiliesJson: text("ruleFamiliesJson").notNull(),
  enabledPatternsJson: text("enabledPatternsJson").notNull(),
  enabledMethodologiesJson: text("enabledMethodologiesJson").notNull(),
  liveAlertsJson: text("liveAlertsJson").notNull(),
  alertThreshold: doublePrecision("alertThreshold").notNull(),
  cooldownMinutes: integer("cooldownMinutes").notNull(),
  quietHoursJson: text("quietHoursJson").notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const signalSnapshots = pgTable(
  "signal_snapshots",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
    venue: varchar("venue", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 12 }).notNull(),
    candleCloseTime: timestamp("candleCloseTime", { withTimezone: true }).notNull(),
    state: varchar("state", { length: 32 }).notNull(),
    score: doublePrecision("score").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    regime: varchar("regime", { length: 32 }).notNull(),
    dataQualityState: varchar("dataQualityState", { length: 32 }).notNull(),
    findingsJson: text("findingsJson").notNull(),
    conflictsJson: text("conflictsJson").notNull(),
    invalidationJson: text("invalidationJson").notNull(),
    strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
    configVersion: integer("configVersion").notNull(),
    sourceManifestId: varchar("sourceManifestId", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("signal_snapshots_asset_time_idx").on(table.assetSymbol, table.timeframe, table.candleCloseTime), index("signal_snapshots_created_idx").on(table.createdAt)],
);

export const candleHistory = pgTable(
  "candle_history",
  {
    id: varchar("id", { length: 96 }).primaryKey(),
    assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
    venue: varchar("venue", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 12 }).notNull(),
    candleCloseTime: timestamp("candleCloseTime", { withTimezone: true }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume").notNull(),
    ema20: doublePrecision("ema20").notNull(),
    ema50: doublePrecision("ema50").notNull(),
    ema200: doublePrecision("ema200").notNull(),
    rsi14: doublePrecision("rsi14").notNull(),
    macd: doublePrecision("macd").notNull(),
    macdSignal: doublePrecision("macdSignal").notNull(),
    atr14: doublePrecision("atr14").notNull(),
    signalState: varchar("signalState", { length: 32 }).notNull(),
    signalScore: doublePrecision("signalScore").notNull(),
    strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
    configVersion: integer("configVersion").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("candle_history_asset_time_idx").on(table.assetSymbol, table.timeframe, table.candleCloseTime), index("candle_history_created_idx").on(table.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    action: varchar("action", { length: 80 }).notNull(),
    actorType: varchar("actorType", { length: 32 }).notNull(),
    actorId: varchar("actorId", { length: 80 }).notNull(),
    payloadJson: text("payloadJson").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_events_created_idx").on(table.createdAt)],
);

export const telegramPollingState = pgTable("telegram_polling_state", {
  id: integer("id").primaryKey(),
  updateOffset: integer("updateOffset").default(0).notNull(),
  lastPolledAt: timestamp("lastPolledAt", { withTimezone: true }),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const runnerHealth = pgTable(
  "runner_health",
  {
    id: integer("id").primaryKey(),
    runId: varchar("runId", { length: 64 }),
    state: varchar("state", { length: 24 }).notNull(),
    configVersion: integer("configVersion"),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    finishedAt: timestamp("finishedAt", { withTimezone: true }),
    cycleCount: integer("cycleCount").default(0).notNull(),
    failureCount: integer("failureCount").default(0).notNull(),
    lastError: text("lastError"),
    summaryJson: text("summaryJson").notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("runner_health_updated_idx").on(table.updatedAt)],
);

export const liveObservations = pgTable(
  "live_observations",
  {
    id: varchar("id", { length: 96 }).primaryKey(),
    assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
    observedAt: timestamp("observedAt", { withTimezone: true }).notNull(),
    conditionId: varchar("conditionId", { length: 64 }).notNull(),
    direction: varchar("direction", { length: 16 }).notNull(),
    score: doublePrecision("score").notNull(),
    dataQualityState: varchar("dataQualityState", { length: 32 }).notNull(),
    evidenceJson: text("evidenceJson").notNull(),
    sourceEventIdsJson: text("sourceEventIdsJson").notNull(),
    configVersion: integer("configVersion").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("live_observations_asset_time_idx").on(table.assetSymbol, table.observedAt)],
);

export const marketPipelineHealth = pgTable(
  "market_pipeline_health",
  {
    component: varchar("component", { length: 24 }).primaryKey(),
    state: varchar("state", { length: 24 }).notNull(),
    lastSuccessAt: timestamp("lastSuccessAt", { withTimezone: true }),
    lastError: text("lastError"),
    lagMs: integer("lagMs"),
    summaryJson: text("summaryJson").notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("market_pipeline_health_state_updated_idx").on(table.state, table.updatedAt)],
);

export const marketArchiveManifests = pgTable(
  "market_archive_manifests",
  {
    id: varchar("id", { length: 96 }).primaryKey(),
    streamType: varchar("streamType", { length: 24 }).notNull(),
    assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
    partitionStart: timestamp("partitionStart", { withTimezone: true }).notNull(),
    partitionEnd: timestamp("partitionEnd", { withTimezone: true }).notNull(),
    objectKey: varchar("objectKey", { length: 512 }).notNull().unique(),
    rowCount: integer("rowCount").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    clickhouseBatchId: varchar("clickhouseBatchId", { length: 96 }).notNull(),
    state: varchar("state", { length: 24 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("market_archive_manifests_partition_idx").on(table.assetSymbol, table.partitionStart)],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type BotConfig = typeof botConfigs.$inferSelect;
export type SignalSnapshot = typeof signalSnapshots.$inferSelect;
export type CandleHistory = typeof candleHistory.$inferSelect;
export type DashboardCredential = typeof dashboardCredentials.$inferSelect;
export type RunnerHealth = typeof runnerHealth.$inferSelect;
export type LiveObservationRecord = typeof liveObservations.$inferSelect;
export type MarketPipelineHealth = typeof marketPipelineHealth.$inferSelect;
export type MarketArchiveManifest = typeof marketArchiveManifests.$inferSelect;
