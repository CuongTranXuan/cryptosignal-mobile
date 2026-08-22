import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";

import { CreateBucketCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { LiveMarketEvent } from "../../shared/live-market-types";

const parquet = require("parquetjs-lite") as {
  ParquetSchema: new (definition: Record<string, unknown>) => unknown;
  ParquetWriter: {
    openStream(
      schema: unknown,
      output: PassThrough,
      options?: { rowGroupSize?: number },
    ): Promise<{ appendRow(row: Record<string, unknown>): Promise<void>; close(): Promise<void> }>;
  };
};

const EVENT_ARCHIVE_SCHEMA = {
  event_id: { type: "UTF8" },
  schema_version: { type: "INT32" },
  venue: { type: "UTF8" },
  stream_type: { type: "UTF8" },
  asset_symbol: { type: "UTF8" },
  exchange_event_time: { type: "UTF8" },
  ingested_at: { type: "UTF8" },
  source_connection_id: { type: "UTF8" },
  is_closed_candle: { type: "BOOLEAN" },
  integrity_hash: { type: "UTF8" },
  payload_json: { type: "UTF8" },
} as const;

export type ArchiveManifest = {
  manifestId: string;
  objectKey: string;
  sha256: string;
  rowCount: number;
  streamType: LiveMarketEvent["streamType"];
  assetSymbol: LiveMarketEvent["assetSymbol"];
  partitionStart: Date;
  partitionEnd: Date;
};

export type ArchiveBatch = {
  manifestId: string;
  manifests: ArchiveManifest[];
};

function createSha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function toArchiveRow(event: LiveMarketEvent) {
  return {
    event_id: event.eventId,
    schema_version: event.schemaVersion,
    venue: event.venue,
    stream_type: event.streamType,
    asset_symbol: event.assetSymbol,
    exchange_event_time: event.exchangeEventTime,
    ingested_at: event.ingestedAt,
    source_connection_id: event.sourceConnectionId,
    is_closed_candle: event.isClosedCandle,
    integrity_hash: event.integrityHash,
    payload_json: JSON.stringify(event.payload),
  };
}

export function createArchivePayloadDigest(events: LiveMarketEvent[]) {
  const canonicalEvents = [...events].sort((left, right) =>
    left.eventId.localeCompare(right.eventId) || left.exchangeEventTime.localeCompare(right.exchangeEventTime),
  );
  return createSha256(stableJson(canonicalEvents));
}

export async function serializeEventsToParquet(events: LiveMarketEvent[]): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    output.once("end", resolve);
    output.once("error", reject);
  });
  const writer = await parquet.ParquetWriter.openStream(new parquet.ParquetSchema(EVENT_ARCHIVE_SCHEMA), output, {
    rowGroupSize: 1_024,
  });

  for (const event of events) {
    await writer.appendRow(toArchiveRow(event));
  }
  await writer.close();
  await completed;
  return Buffer.concat(chunks);
}

export async function verifyArchiveObject(
  headObject: () => Promise<{ contentLength: number | undefined; metadata: Record<string, string | undefined> | undefined }>,
  expected: { contentLength: number; sha256: string },
) {
  const object = await headObject();
  if (object.contentLength !== expected.contentLength || object.metadata?.sha256 !== expected.sha256) {
    throw new Error("archive verification failed");
  }
}

export type ArchiveObjectClient = {
  put(input: { key: string; body: Buffer; contentLength: number; sha256: string }): Promise<void>;
  head(key: string): Promise<{ contentLength: number | undefined; metadata: Record<string, string | undefined> | undefined }>;
};

type SeaweedFsCommandClient = {
  send(command: PutObjectCommand | HeadObjectCommand | HeadBucketCommand | CreateBucketCommand): Promise<{
    ContentLength?: number;
    Metadata?: Record<string, string | undefined>;
    $metadata?: { httpStatusCode?: number };
  }>;
};

export type SeaweedFsArchiveClientOptions = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  forcePathStyle?: boolean;
  client?: SeaweedFsCommandClient;
};

export function createSeaweedFsArchiveClient(options: SeaweedFsArchiveClientOptions): ArchiveObjectClient & { ensureBucket(): Promise<void> } {
  const sdkClient = new S3Client({
    endpoint: options.endpoint,
    region: options.region ?? "us-east-1",
    forcePathStyle: options.forcePathStyle ?? true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });
  const client: SeaweedFsCommandClient = options.client ?? {
    send: async (command) => sdkClient.send(command as never) as Promise<{
      ContentLength?: number;
      Metadata?: Record<string, string | undefined>;
      $metadata?: { httpStatusCode?: number };
    }>,
  };

  const ensureBucket = async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: options.bucket }));
    } catch (error) {
      const status = typeof error === "object" && error !== null && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        : undefined;
      const name = error instanceof Error ? error.name : "";
      if (status !== 404 && name !== "NotFound" && name !== "NoSuchBucket") throw error;
      await client.send(new CreateBucketCommand({ Bucket: options.bucket }));
    }
  };

  return {
    ensureBucket,
    async put(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: input.key,
          Body: input.body,
          ContentLength: input.contentLength,
          Metadata: { sha256: input.sha256 },
        }),
      );
    },
    async head(key) {
      const object = await client.send(new HeadObjectCommand({ Bucket: options.bucket, Key: key }));
      return { contentLength: object.ContentLength, metadata: object.Metadata };
    },
  };
}

export async function uploadAndVerifyArchive(
  client: ArchiveObjectClient,
  input: { key: string; body: Buffer; sha256: string },
) {
  const contentLength = input.body.byteLength;
  await client.put({ key: input.key, body: input.body, contentLength, sha256: input.sha256 });
  await verifyArchiveObject(() => client.head(input.key), { contentLength, sha256: input.sha256 });
  return { contentLength, sha256: input.sha256 };
}

export function buildArchiveObjectKey(event: LiveMarketEvent, batchId?: string) {
  const timestamp = new Date(event.exchangeEventTime);
  const date = timestamp.toISOString().slice(0, 10);
  const hour = timestamp.toISOString().slice(11, 13);
  const prefix = `market-events/venue=binance-public/stream=${event.streamType}/symbol=${event.assetSymbol.replace("/", "-")}/date=${date}/hour=${hour}`;
  return batchId ? `${prefix}/batch=${batchId}/events.parquet` : `${prefix}/events.parquet`;
}

function partitionEvents(events: LiveMarketEvent[]) {
  const partitions = new Map<string, LiveMarketEvent[]>();
  for (const event of events) {
    const key = buildArchiveObjectKey(event);
    const partition = partitions.get(key) ?? [];
    partition.push(event);
    partitions.set(key, partition);
  }
  return [...partitions.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function createSeaweedFsEventArchiver(client: ArchiveObjectClient) {
  return async function archiveEvents(events: LiveMarketEvent[]): Promise<ArchiveBatch> {
    if (events.length === 0) {
      throw new Error("Cannot archive an empty market-event spool segment");
    }

    const manifests: ArchiveManifest[] = [];
    for (const [, partition] of partitionEvents(events)) {
      const body = await serializeEventsToParquet(partition);
      const sha256 = createSha256(body);
      const objectKey = buildArchiveObjectKey(partition[0], sha256.slice(0, 24));
      await uploadAndVerifyArchive(client, { key: objectKey, body, sha256 });
      const orderedByTime = [...partition].sort((left, right) => left.exchangeEventTime.localeCompare(right.exchangeEventTime));
      const manifestId = `market-archive-${createSha256(`${objectKey}:${sha256}`)}`;
      manifests.push({
        manifestId,
        objectKey,
        sha256,
        rowCount: partition.length,
        streamType: partition[0].streamType,
        assetSymbol: partition[0].assetSymbol,
        partitionStart: new Date(orderedByTime[0].exchangeEventTime),
        partitionEnd: new Date(orderedByTime.at(-1)!.exchangeEventTime),
      });
    }

    const manifestId = `market-archive-batch-${createSha256(stableJson(manifests.map((manifest) => ({
      id: manifest.manifestId,
      sha256: manifest.sha256,
    }))))}`;
    return { manifestId, manifests };
  };
}
