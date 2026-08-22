#!/usr/bin/env bash
set -euo pipefail

MANIFEST=""
OBJECT_ROOT=""
S3_ENDPOINT=""
S3_BUCKET=""
S3_ACCESS_KEY=""
S3_SECRET_KEY=""

usage() {
  echo "Usage: $0 --manifest /absolute/path/to/manifest.ndjson (--object-root /absolute/path/to/archive-objects | --s3-endpoint URL --s3-bucket NAME --s3-access-key KEY --s3-secret-key SECRET)" >&2
  exit 64
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --object-root) OBJECT_ROOT="${2:-}"; shift 2 ;;
    --s3-endpoint) S3_ENDPOINT="${2:-}"; shift 2 ;;
    --s3-bucket) S3_BUCKET="${2:-}"; shift 2 ;;
    --s3-access-key) S3_ACCESS_KEY="${2:-}"; shift 2 ;;
    --s3-secret-key) S3_SECRET_KEY="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$MANIFEST" && "$MANIFEST" = /* && -f "$MANIFEST" ]] || usage
if [[ -n "$OBJECT_ROOT" ]]; then
  [[ "$OBJECT_ROOT" = /* && -d "$OBJECT_ROOT" && -z "$S3_ENDPOINT$S3_BUCKET$S3_ACCESS_KEY$S3_SECRET_KEY" ]] || usage
else
  [[ -n "$S3_ENDPOINT" && -n "$S3_BUCKET" && -n "$S3_ACCESS_KEY" && -n "$S3_SECRET_KEY" ]] || usage
fi

verified=0
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  object_key="$(node -e 'const row=JSON.parse(process.argv[1]); process.stdout.write(row.objectKey ?? "")' "$line")"
  expected_sha256="$(node -e 'const row=JSON.parse(process.argv[1]); process.stdout.write(row.sha256 ?? "")' "$line")"
  [[ -n "$object_key" && -n "$expected_sha256" ]] || { echo "manifest entry is missing objectKey or sha256" >&2; exit 65; }
  if [[ -n "$OBJECT_ROOT" ]]; then
    object_path="$OBJECT_ROOT/$object_key"
    [[ -f "$object_path" ]] || { echo "archive object is missing: $object_key" >&2; exit 66; }
    actual_sha256="$(sha256sum "$object_path" | awk '{print $1}')"
    [[ "$actual_sha256" == "$expected_sha256" ]] || { echo "checksum mismatch for $object_key" >&2; exit 65; }
  else
    actual_sha256="$(S3_ENDPOINT="$S3_ENDPOINT" S3_BUCKET="$S3_BUCKET" S3_ACCESS_KEY="$S3_ACCESS_KEY" S3_SECRET_KEY="$S3_SECRET_KEY" OBJECT_KEY="$object_key" node --input-type=module -e '
      import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
      const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY } });
      const result = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: process.env.OBJECT_KEY }));
      process.stdout.write(result.Metadata?.sha256 ?? "");
    ')"
    [[ "$actual_sha256" == "$expected_sha256" ]] || { echo "checksum mismatch for $object_key" >&2; exit 65; }
  fi
  verified=$((verified + 1))
done < "$MANIFEST"

echo "Verified $verified market archive manifest object(s) without modifying archive data."
