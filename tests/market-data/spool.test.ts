import { access, appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMarketSpool } from "../../server/market-data/spool";
import type { LiveMarketEvent } from "../../shared/live-market-types";

const temporaryDirectories: string[] = [];

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

function eventFixture(eventId = "event-1"): LiveMarketEvent {
  return {
    eventId,
    schemaVersion: 1,
    venue: "BINANCE_PUBLIC",
    streamType: "AGG_TRADE",
    assetSymbol: "BTC/USDT",
    exchangeEventTime: "2026-08-22T03:00:00.000Z",
    ingestedAt: "2026-08-22T03:00:00.100Z",
    sourceConnectionId: "collector-1",
    isClosedCandle: false,
    integrityHash: `hash-${eventId}`,
    payload: { price: "112345.67", quantity: "0.0184", maker: false },
  };
}

beforeEach(async () => {
  temporaryDirectories.push(await mkdtemp(join(tmpdir(), "cryptosignal-market-spool-")));
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("durable market event spool", () => {
  it("retains a segment until both writer acknowledgements are recorded", async () => {
    const spool = await createMarketSpool({ directory: temporaryDirectories[0], maxBytes: 128, maxAgeMs: 60_000 });
    await spool.append(eventFixture());
    const [segment] = await spool.listPendingSegments();

    await spool.markClickHouseCommitted(segment.path, "batch-1");
    expect(await exists(segment.path)).toBe(true);

    await spool.markSegmentArchived(segment.path, "manifest-1");
    expect(await exists(segment.path)).toBe(false);
  });

  it("recovers valid records while ignoring a malformed trailing partial line", async () => {
    const spool = await createMarketSpool({ directory: temporaryDirectories[0], maxBytes: 4_096, maxAgeMs: 60_000 });
    await spool.append(eventFixture());
    const [segment] = await spool.listPendingSegments();
    await appendFile(segment.path, '{"eventId":"partial');

    const recovered = await createMarketSpool({ directory: temporaryDirectories[0], maxBytes: 4_096, maxAgeMs: 60_000 });

    await expect(recovered.readSegment(segment.path)).resolves.toEqual([eventFixture()]);
  });

  it("preserves a complete final record even when it has no trailing newline", async () => {
    const spool = await createMarketSpool({ directory: temporaryDirectories[0], maxBytes: 4_096, maxAgeMs: 60_000 });
    await spool.append(eventFixture());
    const [segment] = await spool.listPendingSegments();
    await writeFile(segment.path, JSON.stringify(eventFixture()));

    await expect(spool.readSegment(segment.path)).resolves.toEqual([eventFixture()]);
  });

  it("continues segment ordering after a restart", async () => {
    const firstSpool = await createMarketSpool({ directory: temporaryDirectories[0], maxBytes: 1, maxAgeMs: 60_000 });
    await firstSpool.append(eventFixture("event-1"));
    await firstSpool.append(eventFixture("event-2"));

    const restartedSpool = await createMarketSpool({ directory: temporaryDirectories[0], maxBytes: 1, maxAgeMs: 60_000 });
    await restartedSpool.append(eventFixture("event-3"));
    const segmentPaths = (await restartedSpool.listPendingSegments()).map((segment) => segment.path);

    expect(segmentPaths).toHaveLength(3);
    expect(segmentPaths).toEqual([...segmentPaths].sort());
  });

  it("rotates the active segment when its configured age limit is reached", async () => {
    let currentTime = new Date("2026-08-22T03:00:00.000Z");
    const spool = await createMarketSpool({
      directory: temporaryDirectories[0],
      maxBytes: 4_096,
      maxAgeMs: 1_000,
      now: () => currentTime,
    });
    await spool.append(eventFixture("event-1"));
    currentTime = new Date("2026-08-22T03:00:01.000Z");
    await spool.append(eventFixture("event-2"));

    expect(await spool.listPendingSegments()).toHaveLength(2);
  });

  it("removes an already dual-acknowledged segment during recovery after an interrupted cleanup", async () => {
    const spool = await createMarketSpool({ directory: temporaryDirectories[0], maxBytes: 4_096, maxAgeMs: 60_000 });
    await spool.append(eventFixture());
    const [segment] = await spool.listPendingSegments();
    await writeFile(`${segment.path}.state.json`, '{"clickhouseBatchId":"batch-1","archiveManifestId":"manifest-1"}\n');

    const recovered = await createMarketSpool({ directory: temporaryDirectories[0], maxBytes: 4_096, maxAgeMs: 60_000 });

    await expect(recovered.listPendingSegments()).resolves.toEqual([]);
    expect(await exists(segment.path)).toBe(false);
  });
});
