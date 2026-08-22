import { createArchivePayloadDigest } from "./archive";

import type { MarketComponentHealth, LiveMarketEvent } from "../../shared/live-market-types";

export type ClickHouseMarketEventRow = {
  event_id: string;
  venue: string;
  stream_type: string;
  asset_symbol: string;
  exchange_event_time: string;
  ingested_at: string;
  source_connection_id: string;
  is_closed_candle: number;
  integrity_hash: string;
  payload_json: string;
};

export type ClickHouseMarketEventClient = {
  insert(input: { table: "market_events"; values: ClickHouseMarketEventRow[]; format: "JSONEachRow" }): Promise<unknown>;
};

export function toClickHouseMarketEventRow(event: LiveMarketEvent): ClickHouseMarketEventRow {
  return {
    event_id: event.eventId,
    venue: event.venue,
    stream_type: event.streamType,
    asset_symbol: event.assetSymbol,
    exchange_event_time: event.exchangeEventTime,
    ingested_at: event.ingestedAt,
    source_connection_id: event.sourceConnectionId,
    is_closed_candle: event.isClosedCandle ? 1 : 0,
    integrity_hash: event.integrityHash,
    payload_json: JSON.stringify(event.payload),
  };
}

export async function insertMarketEventsIntoClickHouse(client: ClickHouseMarketEventClient, events: LiveMarketEvent[]) {
  if (events.length === 0) return;
  await client.insert({ table: "market_events", values: events.map(toClickHouseMarketEventRow), format: "JSONEachRow" });
}

export function createClickHouseBatchId(events: LiveMarketEvent[]) {
  return `clickhouse-batch-${createArchivePayloadDigest(events)}`;
}

type Segment = { path: string; clickhouseBatchId: string | null; archiveManifestId: string | null };
type ArchiveResult = {
  manifestId: string;
  objectKey?: string;
  sha256?: string;
  rowCount?: number;
  streamType?: string;
  assetSymbol?: string;
  partitionStart?: Date;
  partitionEnd?: Date;
  manifests?: Array<{
    manifestId: string;
    objectKey: string;
    sha256: string;
    rowCount: number;
    streamType: string;
    assetSymbol: string;
    partitionStart: Date;
    partitionEnd: Date;
  }>;
};
type Deps = {
  spool: { listPendingSegments(): Promise<Segment[]>; readSegment(path: string): Promise<LiveMarketEvent[]>; markClickHouseCommitted(path: string, batchId: string): Promise<void>; markSegmentArchived(path: string, manifestId: string): Promise<void> };
  insertClickHouse(events: LiveMarketEvent[]): Promise<void>;
  archiveEvents(events: LiveMarketEvent[]): Promise<ArchiveResult>;
  recordManifest(input: unknown): Promise<unknown>;
  recordHealth(health: Omit<MarketComponentHealth, "updatedAt">): Promise<unknown>;
};

export function createEventWriter(deps: Deps) {
  return {
    async flushOneSegment() {
      const segment = (await deps.spool.listPendingSegments())[0];
      if (!segment) return false;
      try {
        const events = await deps.spool.readSegment(segment.path);
        let clickhouseBatchId = segment.clickhouseBatchId;
        if (!clickhouseBatchId) {
          await deps.insertClickHouse(events);
          clickhouseBatchId = createClickHouseBatchId(events);
          await deps.spool.markClickHouseCommitted(segment.path, clickhouseBatchId);
        }
        const archive = await deps.archiveEvents(events);
        const manifests = archive.manifests ?? [archive];
        for (const manifest of manifests) {
          await deps.recordManifest({ ...manifest, id: manifest.manifestId, clickhouseBatchId, state: "VERIFIED" });
        }
        await deps.spool.markSegmentArchived(segment.path, archive.manifestId);
        await deps.recordHealth({ component: "WRITER", state: "RUNNING", lastSuccessAt: new Date(), lastError: null, lagMs: 0, summary: {} });
        return true;
      } catch (error) {
        await deps.recordHealth({ component: "WRITER", state: "DEGRADED", lastSuccessAt: null, lastError: error instanceof Error ? error.message : "writer failure", lagMs: null, summary: {} });
        throw error;
      }
    },
  };
}
