import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const temporaryDirectories: string[] = [];

function tempDir() {
  const directory = mkdtempSync(join(tmpdir(), "cryptosignal-market-ops-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("market data operations scripts", () => {
  it("refuses to run a restore without an explicit source and empty destination", () => {
    const result = spawnSync("bash", ["scripts/restore-market-data.sh"], { cwd: root, encoding: "utf8" });

    expect(result.status).toBe(64);
    expect(`${result.stdout}${result.stderr}`).toContain("--source");
  });

  it("fails archive verification when a manifest checksum does not match its local object", () => {
    const directory = tempDir();
    const objectRoot = join(directory, "objects");
    mkdirSync(objectRoot, { recursive: true });
    writeFileSync(join(objectRoot, "events.parquet"), "archive bytes");
    const manifestPath = join(directory, "manifest.ndjson");
    writeFileSync(manifestPath, `${JSON.stringify({ objectKey: "events.parquet", sha256: "not-the-file-digest" })}\n`);

    const result = spawnSync("bash", ["scripts/verify-market-archive.sh", "--manifest", manifestPath, "--object-root", objectRoot], { cwd: root, encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("checksum mismatch");
  });
});
