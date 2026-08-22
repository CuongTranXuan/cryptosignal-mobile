import {
  boolean,
  double,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const dashboardCredentials = mysqlTable(
  "dashboard_credentials",
  {
    id: int("id").autoincrement().primaryKey(),
    username: varchar("username", { length: 64 }).notNull().unique(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  (table) => [index("dashboard_credentials_username_idx").on(table.username)],
);

export const dashboardSessions = mysqlTable(
  "dashboard_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    credentialId: int("credentialId").notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  },
  (table) => [index("dashboard_sessions_credential_idx").on(table.credentialId), index("dashboard_sessions_expiry_idx").on(table.expiresAt)],
);

export const botConfigs = mysqlTable("bot_configs", {
  id: int("id").primaryKey(),
  configVersion: int("configVersion").notNull(),
  isPaused: boolean("isPaused").default(false).notNull(),
  watchlistJson: text("watchlistJson").notNull(),
  timeframesJson: text("timeframesJson").notNull(),
  ruleFamiliesJson: text("ruleFamiliesJson").notNull(),
  enabledPatternsJson: text("enabledPatternsJson").notNull(),
  enabledMethodologiesJson: text("enabledMethodologiesJson").notNull(),
  alertThreshold: double("alertThreshold").notNull(),
  cooldownMinutes: int("cooldownMinutes").notNull(),
  quietHoursJson: text("quietHoursJson").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const signalSnapshots = mysqlTable(
  "signal_snapshots",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
    venue: varchar("venue", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 12 }).notNull(),
    candleCloseTime: timestamp("candleCloseTime").notNull(),
    state: varchar("state", { length: 32 }).notNull(),
    score: double("score").notNull(),
    confidence: double("confidence").notNull(),
    regime: varchar("regime", { length: 32 }).notNull(),
    dataQualityState: varchar("dataQualityState", { length: 32 }).notNull(),
    findingsJson: text("findingsJson").notNull(),
    conflictsJson: text("conflictsJson").notNull(),
    invalidationJson: text("invalidationJson").notNull(),
    strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
    configVersion: int("configVersion").notNull(),
    sourceManifestId: varchar("sourceManifestId", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("signal_snapshots_asset_time_idx").on(table.assetSymbol, table.timeframe, table.candleCloseTime),
    index("signal_snapshots_created_idx").on(table.createdAt),
  ],
);

export const candleHistory = mysqlTable(
  "candle_history",
  {
    id: varchar("id", { length: 96 }).primaryKey(),
    assetSymbol: varchar("assetSymbol", { length: 32 }).notNull(),
    venue: varchar("venue", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 12 }).notNull(),
    candleCloseTime: timestamp("candleCloseTime").notNull(),
    open: double("open").notNull(),
    high: double("high").notNull(),
    low: double("low").notNull(),
    close: double("close").notNull(),
    volume: double("volume").notNull(),
    ema20: double("ema20").notNull(),
    ema50: double("ema50").notNull(),
    ema200: double("ema200").notNull(),
    rsi14: double("rsi14").notNull(),
    macd: double("macd").notNull(),
    macdSignal: double("macdSignal").notNull(),
    atr14: double("atr14").notNull(),
    signalState: varchar("signalState", { length: 32 }).notNull(),
    signalScore: double("signalScore").notNull(),
    strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),
    configVersion: int("configVersion").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("candle_history_asset_time_idx").on(table.assetSymbol, table.timeframe, table.candleCloseTime),
    index("candle_history_created_idx").on(table.createdAt),
  ],
);

export const auditEvents = mysqlTable(
  "audit_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    action: varchar("action", { length: 80 }).notNull(),
    actorType: varchar("actorType", { length: 32 }).notNull(),
    actorId: varchar("actorId", { length: 80 }).notNull(),
    payloadJson: text("payloadJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("audit_events_created_idx").on(table.createdAt)],
);

export const telegramPollingState = mysqlTable("telegram_polling_state", {
  id: int("id").primaryKey(),
  updateOffset: int("updateOffset").default(0).notNull(),
  lastPolledAt: timestamp("lastPolledAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const runnerHealth = mysqlTable(
  "runner_health",
  {
    id: int("id").primaryKey(),
    runId: varchar("runId", { length: 64 }),
    state: varchar("state", { length: 24 }).notNull(),
    configVersion: int("configVersion"),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    cycleCount: int("cycleCount").default(0).notNull(),
    failureCount: int("failureCount").default(0).notNull(),
    lastError: text("lastError"),
    summaryJson: text("summaryJson").notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("runner_health_updated_idx").on(table.updatedAt)],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type BotConfig = typeof botConfigs.$inferSelect;
export type SignalSnapshot = typeof signalSnapshots.$inferSelect;
export type CandleHistory = typeof candleHistory.$inferSelect;
export type DashboardCredential = typeof dashboardCredentials.$inferSelect;
export type RunnerHealth = typeof runnerHealth.$inferSelect;
