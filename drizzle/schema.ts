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

export const botConfigs = mysqlTable("bot_configs", {
  id: int("id").primaryKey(),
  configVersion: int("configVersion").notNull(),
  isPaused: boolean("isPaused").default(false).notNull(),
  watchlistJson: text("watchlistJson").notNull(),
  timeframesJson: text("timeframesJson").notNull(),
  ruleFamiliesJson: text("ruleFamiliesJson").notNull(),
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

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type BotConfig = typeof botConfigs.$inferSelect;
export type SignalSnapshot = typeof signalSnapshots.$inferSelect;
