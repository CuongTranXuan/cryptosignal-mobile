import type { Express } from "express";
import { z } from "zod";
import { getBotConfig, recordCandleHistory, recordRunnerHealth, recordSignalSnapshot } from "./db";
import { SIGNAL_STATES } from "../shared/signal-types";
import { deliverSignalAlert } from "./telegram-polling";

export const signalSnapshotSchema = z.object({
  id: z.string().min(8).max(64),
  assetSymbol: z.string().min(3).max(32),
  venue: z.string().min(2).max(64),
  timeframe: z.string().min(1).max(12),
  candleCloseTime: z.string().datetime(),
  state: z.enum(SIGNAL_STATES),
  score: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  regime: z.string().min(2).max(32),
  dataQualityState: z.string().min(2).max(32),
  findings: z.array(
    z.object({
      findingId: z.string(),
      ruleFamily: z.string(),
      ruleId: z.string(),
      direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
      strength: z.number().min(0).max(1),
      evidence: z.record(z.string(), z.unknown()),
    }),
  ),
  conflicts: z.array(z.string()),
  invalidation: z.record(z.string(), z.unknown()),
  strategyVersion: z.string().min(1).max(32),
  configVersion: z.number().int().positive(),
  sourceManifestId: z.string().min(8).max(64),
});

export const candlePointSchema = z.object({
  id: z.string().min(8).max(96),
  assetSymbol: z.string().min(3).max(32),
  venue: z.string().min(2).max(64),
  timeframe: z.string().min(1).max(12),
  candleCloseTime: z.string().datetime(),
  open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive(), volume: z.number().nonnegative(),
  ema20: z.number(), ema50: z.number(), ema200: z.number(), rsi14: z.number().min(0).max(100), macd: z.number(), macdSignal: z.number(), atr14: z.number().nonnegative(),
  signalState: z.enum(SIGNAL_STATES), signalScore: z.number().min(-1).max(1),
  strategyVersion: z.string().min(1).max(32), configVersion: z.number().int().positive(),
});

export const runnerHealthSchema = z.object({
  runId: z.string().min(8).max(64).nullable(),
  state: z.enum(["IDLE", "RUNNING", "SUCCESS", "DEGRADED", "PAUSED"]),
  configVersion: z.number().int().positive().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  cycleCount: z.number().int().min(0).max(100).default(0),
  failureCount: z.number().int().min(0).max(100).default(0),
  lastError: z.string().max(2000).nullable(),
  summary: z.record(z.string(), z.unknown()).default({}),
});

function validateIngestToken(token: string | undefined) {
  const expected = process.env.SIGNAL_INGEST_TOKEN;
  return Boolean(expected && token && token === expected);
}

export function registerSignalIngestRoutes(app: Express) {
  app.get("/api/signals/config", async (_req, res) => {
    res.json({ config: await getBotConfig() });
  });

  app.get("/api/signals/ingest/health", (req, res) => {
    if (!validateIngestToken(req.header("x-signal-ingest-token"))) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    res.json({ ok: true, mode: "SIGNALS_ONLY" });
  });

  app.post("/api/signals/ingest", async (req, res) => {
    if (!validateIngestToken(req.header("x-signal-ingest-token"))) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const parsed = signalSnapshotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    const persisted = await recordSignalSnapshot(parsed.data);
    const alert = persisted.isNew ? await deliverSignalAlert(persisted.snapshot) : { delivered: false, reason: "DUPLICATE" as const };
    res.status(persisted.isNew ? 201 : 200).json({ ok: true, snapshot: persisted.snapshot, alert });
  });

  app.post("/api/signals/candles", async (req, res) => {
    if (!validateIngestToken(req.header("x-signal-ingest-token"))) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const parsed = z.array(candlePointSchema).min(1).max(500).safeParse(req.body?.candles);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    res.status(201).json({ ok: true, ...(await recordCandleHistory(parsed.data)) });
  });

  app.post("/api/signals/runner-health", async (req, res) => {
    if (!validateIngestToken(req.header("x-signal-ingest-token"))) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const parsed = runnerHealthSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    const update = parsed.data;
    const health = await recordRunnerHealth({
      ...update,
      startedAt: update.startedAt ? new Date(update.startedAt) : null,
      finishedAt: update.finishedAt ? new Date(update.finishedAt) : null,
    });
    res.status(200).json({ ok: true, health });
  });
}
