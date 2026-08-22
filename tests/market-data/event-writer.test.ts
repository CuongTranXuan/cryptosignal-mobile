import { describe, expect, it, vi } from "vitest";

import { createEventWriter } from "../../server/market-data/event-writer";
import type { LiveMarketEvent } from "../../shared/live-market-types";

const eventFixture: LiveMarketEvent = {
  eventId: "event-1",
  schemaVersion: 1,
  venue: "BINANCE_PUBLIC",
  streamType: "AGG_TRADE",
  assetSymbol: "BTC/USDT",
  exchangeEventTime: "2026-08-22T03:30:00.000Z",
  ingestedAt: "2026-08-22T03:30:00.001Z",
  sourceConnectionId: "collector-1",
  isClosedCandle: false,
  integrityHash: "hash-1",
  payload: { price: "112345.67" },
};

describe("local event writer", () => {
  it("does not archive-acknowledge a spool segment when SeaweedFS verification fails", async () => {
    const segment = { path: "/spool/segment-1.ndjson", clickhouseBatchId: null, archiveManifestId: null };
    const spool = {
      listPendingSegments: vi.fn(async () => [segment]),
      readSegment: vi.fn(async () => [eventFixture]),
      markClickHouseCommitted: vi.fn(async () => undefined),
      markSegmentArchived: vi.fn(async () => undefined),
    };
    const writer = createEventWriter({
      spool,
      insertClickHouse: vi.fn(async () => undefined),
      archiveEvents: vi.fn(async () => {
        throw new Error("archive verification failed");
      }),
      recordManifest: vi.fn(async () => undefined),
      recordHealth: vi.fn(async () => undefined),
    });

    await expect(writer.flushOneSegment()).rejects.toThrow("archive verification failed");
    expect(spool.markSegmentArchived).not.toHaveBeenCalled();
  });

  it("skips ClickHouse reinsertion when replaying a segment already marked committed locally", async () => {
    const segment = { path: "/spool/segment-2.ndjson", clickhouseBatchId: "batch-existing", archiveManifestId: null };
    const spool = {
      listPendingSegments: vi.fn(async () => [segment]),
      readSegment: vi.fn(async () => [eventFixture]),
      markClickHouseCommitted: vi.fn(async () => undefined),
      markSegmentArchived: vi.fn(async () => undefined),
    };
    const insertClickHouse = vi.fn(async () => undefined);
    const recordManifest = vi.fn(async () => undefined);
    const writer = createEventWriter({
      spool,
      insertClickHouse,
      archiveEvents: vi.fn(async () => ({ manifestId: "manifest-2", objectKey: "object-key", sha256: "sha-256", rowCount: 1 })),
      recordManifest,
      recordHealth: vi.fn(async () => undefined),
    });

    await expect(writer.flushOneSegment()).resolves.toBe(true);
    expect(insertClickHouse).not.toHaveBeenCalled();
    expect(recordManifest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "manifest-2", state: "VERIFIED", clickhouseBatchId: "batch-existing" }),
    );
  });

  it("leaves an uncommitted segment pending after a transient ClickHouse error and retries it on the next flush", async () => {
    const segment = { path: "/spool/segment-2-retry.ndjson", clickhouseBatchId: null, archiveManifestId: null };
    const spool = {
      listPendingSegments: vi.fn(async () => [segment]),
      readSegment: vi.fn(async () => [eventFixture]),
      markClickHouseCommitted: vi.fn(async () => undefined),
      markSegmentArchived: vi.fn(async () => undefined),
    };
    const insertClickHouse = vi.fn().mockRejectedValueOnce(new Error("ClickHouse unavailable")).mockResolvedValueOnce(undefined);
    const writer = createEventWriter({
      spool,
      insertClickHouse,
      archiveEvents: vi.fn(async () => ({ manifestId: "manifest-retry", objectKey: "object-key", sha256: "sha-256", rowCount: 1 })),
      recordManifest: vi.fn(async () => undefined),
      recordHealth: vi.fn(async () => undefined),
    });

    await expect(writer.flushOneSegment()).rejects.toThrow("ClickHouse unavailable");
    expect(spool.markClickHouseCommitted).not.toHaveBeenCalled();
    await expect(writer.flushOneSegment()).resolves.toBe(true);
    expect(insertClickHouse).toHaveBeenCalledTimes(2);
    expect(spool.markClickHouseCommitted).toHaveBeenCalledTimes(1);
  });

  it("leaves the spool segment available when manifest recording fails after archive verification", async () => {
    const segment = { path: "/spool/segment-3.ndjson", clickhouseBatchId: null, archiveManifestId: null };
    const spool = {
      listPendingSegments: vi.fn(async () => [segment]),
      readSegment: vi.fn(async () => [eventFixture]),
      markClickHouseCommitted: vi.fn(async () => undefined),
      markSegmentArchived: vi.fn(async () => undefined),
    };
    const writer = createEventWriter({
      spool,
      insertClickHouse: vi.fn(async () => undefined),
      archiveEvents: vi.fn(async () => ({ manifestId: "manifest-3", objectKey: "object-key", sha256: "sha-256", rowCount: 1 })),
      recordManifest: vi.fn(async () => {
        throw new Error("manifest write failed");
      }),
      recordHealth: vi.fn(async () => undefined),
    });

    await expect(writer.flushOneSegment()).rejects.toThrow("manifest write failed");
    expect(spool.markSegmentArchived).not.toHaveBeenCalled();
  });

  it("records every verified archive partition and acknowledges the spool with the archive batch identity", async () => {
    const segment = { path: "/spool/segment-multi-partition.ndjson", clickhouseBatchId: "clickhouse-batch-existing", archiveManifestId: null };
    const spool = {
      listPendingSegments: vi.fn(async () => [segment]),
      readSegment: vi.fn(async () => [eventFixture]),
      markClickHouseCommitted: vi.fn(async () => undefined),
      markSegmentArchived: vi.fn(async () => undefined),
    };
    const recordManifest = vi.fn(async () => undefined);
    const writer = createEventWriter({
      spool,
      insertClickHouse: vi.fn(async () => undefined),
      archiveEvents: vi.fn(async () => ({
        manifestId: "market-archive-batch-a",
        manifests: [
          { manifestId: "manifest-a", objectKey: "a", sha256: "a", rowCount: 1, streamType: "AGG_TRADE", assetSymbol: "BTC/USDT", partitionStart: new Date("2026-08-22T03:00:00.000Z"), partitionEnd: new Date("2026-08-22T03:30:00.000Z") },
          { manifestId: "manifest-b", objectKey: "b", sha256: "b", rowCount: 1, streamType: "BOOK_TICKER", assetSymbol: "BTC/USDT", partitionStart: new Date("2026-08-22T03:00:00.000Z"), partitionEnd: new Date("2026-08-22T03:30:00.000Z") },
        ],
      })),
      recordManifest,
      recordHealth: vi.fn(async () => undefined),
    });

    await expect(writer.flushOneSegment()).resolves.toBe(true);
    expect(recordManifest).toHaveBeenCalledTimes(2);
    expect(spool.markSegmentArchived).toHaveBeenCalledWith(segment.path, "market-archive-batch-a");
  });
});
