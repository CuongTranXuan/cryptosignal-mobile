import { createClient } from "@clickhouse/client";

import { recordMarketArchiveManifest, recordMarketPipelineHealth } from "../server/db";
import { createSeaweedFsArchiveClient, createSeaweedFsEventArchiver } from "../server/market-data/archive";
import { createEventWriter, insertMarketEventsIntoClickHouse } from "../server/market-data/event-writer";
import { createMarketSpool } from "../server/market-data/spool";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function requireEnvironment(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} must be set for the local market event writer`);
  return value;
}

async function main() {
  if (process.env.MARKET_WRITER_ENABLED !== "true") {
    throw new Error("MARKET_WRITER_ENABLED must be true to run the local market event writer");
  }

  const clickhouse = createClient({
    url: requireEnvironment("CLICKHOUSE_URL", "http://clickhouse:8123"),
    username: requireEnvironment("CLICKHOUSE_USER", "cryptosignal"),
    password: requireEnvironment("CLICKHOUSE_PASSWORD"),
    database: "marketdata",
  });
  const spool = await createMarketSpool({
    directory: process.env.MARKET_SPOOL_DIR ?? "/var/lib/cryptosignal/market-spool",
    maxBytes: 16 * 1024 * 1024,
    maxAgeMs: 5 * 60_000,
  });
  const archiveClient = createSeaweedFsArchiveClient({
    bucket: requireEnvironment("SEAWEEDFS_S3_BUCKET", "market-archive"),
    endpoint: requireEnvironment("SEAWEEDFS_S3_ENDPOINT", "http://seaweedfs:8333"),
    accessKeyId: requireEnvironment("SEAWEEDFS_S3_ACCESS_KEY"),
    secretAccessKey: requireEnvironment("SEAWEEDFS_S3_SECRET_KEY"),
  });
  await archiveClient.ensureBucket();
  const writer = createEventWriter({
    spool,
    insertClickHouse: (events) => insertMarketEventsIntoClickHouse(clickhouse, events),
    archiveEvents: createSeaweedFsEventArchiver(archiveClient),
    recordManifest: recordMarketArchiveManifest,
    recordHealth: recordMarketPipelineHealth,
  });
  const interval = Number.parseInt(process.env.MARKET_WRITER_INTERVAL_MS ?? "1000", 10);
  const intervalMs = Number.isFinite(interval) && interval > 0 ? interval : 1000;
  let stopping = false;

  const shutdown = async () => {
    stopping = true;
    await clickhouse.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  while (!stopping) {
    try {
      while (!stopping && (await writer.flushOneSegment())) {
        // Drain pending segments in order before sleeping.
      }
    } catch (error) {
      console.error("[market-event-writer] flush failed", error);
    }
    if (!stopping) await sleep(intervalMs);
  }
}

void main().catch((error) => {
  console.error("[market-event-writer] startup failed", error);
  process.exit(1);
});
