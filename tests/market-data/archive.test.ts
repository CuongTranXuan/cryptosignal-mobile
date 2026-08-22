import { describe, expect, it } from "vitest";

import { CreateBucketCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import {
  buildArchiveObjectKey,
  createArchivePayloadDigest,
  createSeaweedFsArchiveClient,
  serializeEventsToParquet,
  uploadAndVerifyArchive,
  verifyArchiveObject,
} from "../../server/market-data/archive";
import type { LiveMarketEvent } from "../../shared/live-market-types";

const parquet = require("parquetjs-lite") as {
  ParquetReader: {
    openBuffer(buffer: Buffer): Promise<{
      getCursor(): { next(): Promise<Record<string, unknown> | null> };
      close(): Promise<void>;
    }>;
  };
};

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

describe("local event archive", () => {
  it("uses a deterministic partitioned object key", () => {
    expect(buildArchiveObjectKey(eventFixture)).toBe(
      "market-events/venue=binance-public/stream=AGG_TRADE/symbol=BTC-USDT/date=2026-08-22/hour=03/events.parquet",
    );
  });

  it("derives a deterministic SHA-256 digest from the normalized event payload set", () => {
    expect(createArchivePayloadDigest([eventFixture])).toBe("42ce2e33dcae73049633669cf3f37418d44ae2e205ea35c9677ba00bf265f0eb");
  });

  it("derives the same archive digest when equivalent payload keys are provided in a different insertion order", () => {
    const reorderedPayload = {
      ...eventFixture,
      payload: { quantity: "1.25", price: "112345.67" },
    };
    const originalPayload = {
      ...eventFixture,
      payload: { price: "112345.67", quantity: "1.25" },
    };

    expect(createArchivePayloadDigest([reorderedPayload])).toBe(createArchivePayloadDigest([originalPayload]));
  });

  it("derives the same archive digest when the same normalized event set is replayed in a different order", () => {
    const laterEvent = {
      ...eventFixture,
      eventId: "event-2",
      exchangeEventTime: "2026-08-22T03:31:00.000Z",
      integrityHash: "hash-2",
    };

    expect(createArchivePayloadDigest([eventFixture, laterEvent])).toBe(createArchivePayloadDigest([laterEvent, eventFixture]));
  });

  it("serializes the complete normalized event envelope into a readable Parquet archive", async () => {
    const archive = await serializeEventsToParquet([eventFixture]);
    const reader = await parquet.ParquetReader.openBuffer(archive);
    const row = await reader.getCursor().next();
    await reader.close();

    expect(archive.subarray(0, 4).toString("utf8")).toBe("PAR1");
    expect(row).toMatchObject({
      event_id: "event-1",
      schema_version: 1,
      asset_symbol: "BTC/USDT",
      is_closed_candle: false,
      payload_json: JSON.stringify(eventFixture.payload),
    });
  });

  it("rejects an archive object whose verified metadata does not match the expected content", async () => {
    await expect(
      verifyArchiveObject(
        async () => ({ contentLength: 12, metadata: { sha256: "wrong" } }),
        { contentLength: 13, sha256: "expected" },
      ),
    ).rejects.toThrow("archive verification failed");
  });

  it("uploads content with its digest metadata and verifies the same local object before returning", async () => {
    const calls: string[] = [];
    const result = await uploadAndVerifyArchive(
      {
        put: async ({ key, contentLength, sha256 }) => {
          calls.push(`put:${key}:${contentLength}:${sha256}`);
        },
        head: async () => ({ contentLength: 3, metadata: { sha256: "digest" } }),
      },
      { key: "market-events/example.parquet", body: Buffer.from("abc"), sha256: "digest" },
    );

    expect(calls).toEqual(["put:market-events/example.parquet:3:digest"]);
    expect(result).toEqual({ contentLength: 3, sha256: "digest" });
  });

  it("uses SeaweedFS S3 PutObject and HeadObject commands with immutable digest metadata", async () => {
    const commands: unknown[] = [];
    const client = createSeaweedFsArchiveClient({
      bucket: "market-archive",
      endpoint: "http://seaweedfs:8333",
      accessKeyId: "local-access-key",
      secretAccessKey: "local-secret-key",
      client: {
        send: async (command) => {
          commands.push(command);
          if (command instanceof HeadObjectCommand) {
            return { ContentLength: 3, Metadata: { sha256: "digest" } };
          }
          return {};
        },
      },
    });

    await uploadAndVerifyArchive(client, { key: "market-events/example.parquet", body: Buffer.from("abc"), sha256: "digest" });

    expect(commands).toHaveLength(2);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect((commands[0] as PutObjectCommand).input).toMatchObject({
      Bucket: "market-archive",
      Key: "market-events/example.parquet",
      ContentLength: 3,
      Metadata: { sha256: "digest" },
    });
    expect(commands[1]).toBeInstanceOf(HeadObjectCommand);
  });

  it("creates the required local SeaweedFS bucket only when the S3 endpoint reports it missing", async () => {
    let headAttempted = false;
    const commands: unknown[] = [];
    const client = createSeaweedFsArchiveClient({
      bucket: "market-archive",
      endpoint: "http://seaweedfs:8333",
      accessKeyId: "local-access-key",
      secretAccessKey: "local-secret-key",
      client: {
        send: async (command) => {
          commands.push(command);
          if (!headAttempted) {
            headAttempted = true;
            const error = new Error("missing bucket") as Error & { $metadata: { httpStatusCode: number } };
            error.$metadata = { httpStatusCode: 404 };
            throw error;
          }
          return {};
        },
      },
    });

    await client.ensureBucket();

    expect(commands[1]).toBeInstanceOf(CreateBucketCommand);
  });
});
