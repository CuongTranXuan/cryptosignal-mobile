#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
OUTPUT_DIR=""

usage() {
  echo "Usage: $0 --output-dir /absolute/backup/directory" >&2
  exit 64
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$OUTPUT_DIR" && "$OUTPUT_DIR" = /* ]] || usage
command -v docker >/dev/null || { echo "Docker is required for a live market-data backup" >&2; exit 69; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage_dir="$OUTPUT_DIR/cryptosignal-market-$timestamp"
archive_path="$OUTPUT_DIR/cryptosignal-market-$timestamp.tar.gz"
mkdir -p "$stage_dir"
trap 'rm -rf "$stage_dir"' EXIT

cp "$COMPOSE_FILE" "$stage_dir/docker-compose.yml"
[[ -f "$ROOT_DIR/infra/cryptosignal.env.example" ]] && cp "$ROOT_DIR/infra/cryptosignal.env.example" "$stage_dir/cryptosignal.env.example"

echo "Exporting SeaweedFS local data volume..."
docker compose -f "$COMPOSE_FILE" --profile market-retain exec -T seaweedfs sh -c 'tar -C /data -czf - .' > "$stage_dir/seaweedfs-data.tar.gz"

echo "Exporting ClickHouse market tables..."
docker compose -f "$COMPOSE_FILE" --profile market-retain exec -T clickhouse sh -c 'clickhouse-client --query "SELECT * FROM marketdata.market_events FORMAT JSONEachRow"' > "$stage_dir/clickhouse-market-events.ndjson"

echo "Exporting market archive manifest ledger through the web service database connection..."
docker compose -f "$COMPOSE_FILE" exec -T web node --input-type=module -e '
  import pg from "pg";
  const connection = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await connection.connect();
  const { rows } = await connection.query('SELECT "id", "streamType", "assetSymbol", "partitionStart", "partitionEnd", "objectKey", "rowCount", "sha256", "clickhouseBatchId", "state", "createdAt" FROM "market_archive_manifests" ORDER BY "partitionStart" ASC, "id" ASC');
  for (const row of rows) console.log(JSON.stringify(row));
  await connection.end();
' > "$stage_dir/market-archive-manifests.ndjson"

tar -C "$OUTPUT_DIR" -czf "$archive_path" "$(basename "$stage_dir")"
sha256sum "$archive_path" > "$archive_path.sha256"
echo "Created non-destructive market-data backup: $archive_path"
