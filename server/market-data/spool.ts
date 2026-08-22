import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type { LiveMarketEvent } from "../../shared/live-market-types";

const SEGMENT_FILE_PATTERN = /^segment-(\d{13})-(\d{6})\.ndjson$/;

export type MarketSpoolOptions = {
  directory: string;
  maxBytes: number;
  maxAgeMs: number;
  now?: () => Date;
};

export type MarketSpoolSegment = {
  path: string;
  byteLength: number;
  createdAt: Date;
  clickhouseBatchId: string | null;
  archiveManifestId: string | null;
};

type SegmentAcknowledgements = {
  clickhouseBatchId?: string;
  archiveManifestId?: string;
};

type ActiveSegment = {
  path: string;
  byteLength: number;
  createdAt: Date;
};

export type MarketSpool = {
  append(event: LiveMarketEvent): Promise<string>;
  listPendingSegments(): Promise<MarketSpoolSegment[]>;
  readSegment(path: string): Promise<LiveMarketEvent[]>;
  markClickHouseCommitted(path: string, batchId: string): Promise<void>;
  markSegmentArchived(path: string, manifestId: string): Promise<void>;
  recover(): Promise<MarketSpoolSegment[]>;
};

function acknowledgementPath(segmentPath: string) {
  return `${segmentPath}.state.json`;
}

function parseSegmentFilename(path: string) {
  const match = SEGMENT_FILE_PATTERN.exec(basename(path));
  if (!match) {
    return null;
  }

  return {
    createdAt: new Date(Number(match[1])),
    sequence: Number(match[2]),
    timestamp: Number(match[1]),
  };
}

async function readAcknowledgements(segmentPath: string): Promise<SegmentAcknowledgements> {
  try {
    return JSON.parse(await readFile(acknowledgementPath(segmentPath), "utf8")) as SegmentAcknowledgements;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeAcknowledgementsAtomically(segmentPath: string, acknowledgements: SegmentAcknowledgements) {
  const statePath = acknowledgementPath(segmentPath);
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(acknowledgements)}\n`;
  const file = await open(temporaryPath, "w");

  try {
    await file.writeFile(serialized, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }

  await rename(temporaryPath, statePath);
}

class LocalMarketSpool implements MarketSpool {
  private activeSegment: ActiveSegment | null = null;
  private latestTimestamp = 0;
  private sequence = 0;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: Required<MarketSpoolOptions>) {}

  async initialize() {
    await mkdir(this.options.directory, { recursive: true });
    const segments = await this.recoverUnsafe();

    for (const segment of segments) {
      const parsed = parseSegmentFilename(segment.path);
      if (!parsed) {
        continue;
      }

      if (parsed.timestamp > this.latestTimestamp) {
        this.latestTimestamp = parsed.timestamp;
        this.sequence = parsed.sequence;
      } else if (parsed.timestamp === this.latestTimestamp) {
        this.sequence = Math.max(this.sequence, parsed.sequence);
      }
    }

    return segments;
  }

  append(event: LiveMarketEvent) {
    return this.enqueue(async () => {
      const serialized = `${JSON.stringify(event)}\n`;
      const byteLength = Buffer.byteLength(serialized);
      const now = this.options.now();

      if (this.shouldRotate(byteLength, now)) {
        this.activeSegment = null;
      }

      if (!this.activeSegment) {
        this.activeSegment = await this.createSegment(now);
      }

      const file = await open(this.activeSegment.path, "a");
      try {
        await file.writeFile(serialized, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }

      this.activeSegment.byteLength += byteLength;
      return this.activeSegment.path;
    });
  }

  listPendingSegments() {
    return this.enqueue(() => this.listPendingSegmentsUnsafe());
  }

  readSegment(segmentPath: string) {
    return this.enqueue(() => this.readSegmentUnsafe(segmentPath));
  }

  markClickHouseCommitted(segmentPath: string, batchId: string) {
    return this.enqueue(() => this.acknowledge(segmentPath, { clickhouseBatchId: batchId }));
  }

  markSegmentArchived(segmentPath: string, manifestId: string) {
    return this.enqueue(() => this.acknowledge(segmentPath, { archiveManifestId: manifestId }));
  }

  recover() {
    return this.enqueue(async () => {
      this.activeSegment = null;
      return this.recoverUnsafe();
    });
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private shouldRotate(nextByteLength: number, now: Date) {
    if (!this.activeSegment || this.activeSegment.byteLength === 0) {
      return false;
    }

    return (
      this.activeSegment.byteLength + nextByteLength > this.options.maxBytes ||
      now.getTime() - this.activeSegment.createdAt.getTime() >= this.options.maxAgeMs
    );
  }

  private async createSegment(now: Date): Promise<ActiveSegment> {
    const currentTimestamp = now.getTime();
    const timestamp = Math.max(currentTimestamp, this.latestTimestamp);
    this.sequence = timestamp === this.latestTimestamp ? this.sequence + 1 : 1;
    this.latestTimestamp = timestamp;

    const filename = `segment-${String(timestamp).padStart(13, "0")}-${String(this.sequence).padStart(6, "0")}.ndjson`;
    const path = resolve(this.options.directory, filename);
    const file = await open(path, "ax");
    await file.close();

    return { path, byteLength: 0, createdAt: new Date(timestamp) };
  }

  private async listPendingSegmentsUnsafe(): Promise<MarketSpoolSegment[]> {
    const entries = await readdir(this.options.directory, { withFileTypes: true });
    const segmentNames = entries
      .filter((entry) => entry.isFile() && SEGMENT_FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    return Promise.all(
      segmentNames.map(async (name) => {
        const path = resolve(this.options.directory, name);
        const [metadata, acknowledgements] = await Promise.all([stat(path), readAcknowledgements(path)]);
        const parsed = parseSegmentFilename(path);

        if (!parsed) {
          throw new Error(`Unexpected spool segment filename: ${name}`);
        }

        return {
          path,
          byteLength: metadata.size,
          createdAt: parsed.createdAt,
          clickhouseBatchId: acknowledgements.clickhouseBatchId ?? null,
          archiveManifestId: acknowledgements.archiveManifestId ?? null,
        };
      }),
    );
  }

  private async recoverUnsafe() {
    const segments = await this.listPendingSegmentsUnsafe();
    const completedSegments = segments.filter((segment) => segment.clickhouseBatchId && segment.archiveManifestId);

    await Promise.all(
      completedSegments.map((segment) =>
        Promise.all([rm(segment.path, { force: true }), rm(acknowledgementPath(segment.path), { force: true })]),
      ),
    );

    return segments.filter((segment) => !(segment.clickhouseBatchId && segment.archiveManifestId));
  }

  private async readSegmentUnsafe(segmentPath: string): Promise<LiveMarketEvent[]> {
    this.assertSegmentPath(segmentPath);
    const contents = await readFile(segmentPath, "utf8");
    const lines = contents.split("\n");
    const hasTrailingNewline = contents.endsWith("\n");
    const completeLineCount = hasTrailingNewline ? lines.length - 1 : lines.length - 1;
    const events: LiveMarketEvent[] = [];

    for (let index = 0; index < completeLineCount; index += 1) {
      const line = lines[index];
      if (!line) {
        continue;
      }
      events.push(JSON.parse(line) as LiveMarketEvent);
    }

    return events;
  }

  private async acknowledge(segmentPath: string, update: SegmentAcknowledgements) {
    this.assertSegmentPath(segmentPath);
    const acknowledgements = { ...(await readAcknowledgements(segmentPath)), ...update };
    await writeAcknowledgementsAtomically(segmentPath, acknowledgements);

    if (acknowledgements.clickhouseBatchId && acknowledgements.archiveManifestId) {
      await Promise.all([rm(segmentPath), rm(acknowledgementPath(segmentPath), { force: true })]);
      if (this.activeSegment?.path === segmentPath) {
        this.activeSegment = null;
      }
    }
  }

  private assertSegmentPath(segmentPath: string) {
    const expectedDirectory = resolve(this.options.directory);
    if (dirname(resolve(segmentPath)) !== expectedDirectory || !SEGMENT_FILE_PATTERN.test(basename(segmentPath))) {
      throw new Error("Spool segment must be located directly inside the configured spool directory");
    }
  }
}

export async function createMarketSpool(options: MarketSpoolOptions): Promise<MarketSpool> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new Error("Market spool maxBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs <= 0) {
    throw new Error("Market spool maxAgeMs must be a positive integer");
  }

  const spool = new LocalMarketSpool({ ...options, now: options.now ?? (() => new Date()) });
  await spool.initialize();
  return spool;
}
