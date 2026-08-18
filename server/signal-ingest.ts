import type { Express } from "express";
import { z } from "zod";
import { getBotConfig, recordSignalSnapshot } from "./db";
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
}
