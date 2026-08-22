#!/usr/bin/env bash
set -euo pipefail

SOURCE=""
TARGET=""

usage() {
  echo "Usage: $0 --source /absolute/path/to/cryptosignal-market.tar.gz --target-empty-dir /absolute/empty/restore-directory" >&2
  exit 64
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --target-empty-dir) TARGET="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$SOURCE" && -n "$TARGET" && "$SOURCE" = /* && "$TARGET" = /* ]] || usage
[[ -f "$SOURCE" ]] || { echo "Backup source is not a readable file: $SOURCE" >&2; exit 66; }
mkdir -p "$TARGET"
[[ -z "$(find "$TARGET" -mindepth 1 -print -quit)" ]] || { echo "Restore target must be empty: $TARGET" >&2; exit 73; }

echo "Restore plan (no services are started and no existing data is overwritten):"
echo "  source: $SOURCE"
echo "  destination: $TARGET"
echo "  action: extract backup archive into the empty destination for operator review"
tar -xzf "$SOURCE" -C "$TARGET"
echo "Restore staging completed. Verify checksums and import data into a stopped local deployment manually."
