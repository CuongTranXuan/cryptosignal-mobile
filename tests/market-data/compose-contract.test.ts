import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const compose = readFileSync(resolve(projectRoot, "infra/docker-compose.yml"), "utf8");
const clickhouseInit = readFileSync(resolve(projectRoot, "infra/clickhouse/init/001_market_events.sql"), "utf8");
const environmentTemplate = readFileSync(resolve(projectRoot, "infra/cryptosignal.env.example"), "utf8");

describe("local market-data Compose contracts", () => {
  it("keeps Redis, ClickHouse, and SeaweedFS off published host ports", () => {
    expect(compose).toContain('profiles: ["market-live"]');
    expect(compose).toContain('profiles: ["market-retain", "mcp-research"]');
    expect(compose).toMatch(/market-internal:[\s\S]*?internal:\s*true/);
    expect(compose).not.toMatch(/clickhouse:[\s\S]*?ports:/);
    expect(compose).not.toMatch(/redis:[\s\S]*?ports:/);
    expect(compose).not.toMatch(/seaweedfs:[\s\S]*?ports:/);
  });

  it("provisions health-checked local services and an aggregate-state replay table without exchange credentials", () => {
    expect(compose.match(/healthcheck:/g)).toHaveLength(4);
    expect(clickhouseInit).toContain("ENGINE = AggregatingMergeTree");
    expect(clickhouseInit).not.toContain("SummingMergeTree");
    expect(clickhouseInit).toContain("minState");
    expect(clickhouseInit).toContain("argMinState");
    expect(clickhouseInit).toContain("TTL exchange_event_time + INTERVAL 90 DAY DELETE");
    expect(environmentTemplate).toContain("MARKET_REDIS_URL=redis://redis:6379/0");
    expect(environmentTemplate).toContain("SEAWEEDFS_S3_ENDPOINT=http://seaweedfs:8333");
    expect(environmentTemplate).not.toMatch(/BINANCE.*(?:KEY|SECRET)|BINANCE_API/i);
  });

  it("runs the durable event writer only in the internal market-retain profile with healthy local-store dependencies", () => {
    expect(compose).toMatch(/event-writer:[\s\S]*?profiles: \["market-retain"\][\s\S]*?clickhouse:[\s\S]*?condition: service_healthy[\s\S]*?seaweedfs:[\s\S]*?condition: service_healthy/);
    expect(compose).toContain('command: ["node", "dist/scripts/run-event-writer.js"]');
    expect(compose).toContain("- market_collector_spool:/var/lib/cryptosignal/market-spool");
    expect(compose).not.toMatch(/event-writer:[\s\S]*?ports:/);
  });
});
